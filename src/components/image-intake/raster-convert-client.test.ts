import { describe, expect, it, vi } from "vitest";
import { createRasterConvertClient } from "./raster-convert-client";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import type {
  RasterConvertWorkerRequestMessage,
  RasterConvertWorkerResultMessage,
} from "./raster-convert.worker";
import type { RasterConvertWorkerLike } from "./raster-convert-client";

class FakeWorker implements RasterConvertWorkerLike {
  postMessageCalls: RasterConvertWorkerRequestMessage[] = [];
  terminated = false;
  private listeners: Array<(event: MessageEvent<RasterConvertWorkerResultMessage>) => void> = [];

  postMessage(message: RasterConvertWorkerRequestMessage): void {
    this.postMessageCalls.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<RasterConvertWorkerResultMessage>) => void,
  ): void {
    this.listeners.push(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<RasterConvertWorkerResultMessage>) => void,
  ): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: RasterConvertWorkerResultMessage): void {
    for (const listener of [...this.listeners]) {
      listener({ data } as MessageEvent<RasterConvertWorkerResultMessage>);
    }
  }
}

function makeTask(
  id: string,
  sourceFormat: "png" | "webp" | "avif" = "png",
): {
  id: string;
  buffer: ArrayBuffer;
  sourceFormat: "png" | "webp" | "avif";
  quality: number;
  background: typeof DEFAULT_RASTER_BACKGROUND;
} {
  return {
    id,
    buffer: new ArrayBuffer(4),
    sourceFormat,
    quality: 0.8,
    background: DEFAULT_RASTER_BACKGROUND,
  };
}

function doneMessage(id: string): RasterConvertWorkerResultMessage {
  return {
    id,
    type: "result",
    status: "done",
    jpegBuffer: new ArrayBuffer(4),
    width: 100,
    height: 100,
    quality: 0.8,
    elapsedMs: 10,
  };
}

describe("createRasterConvertClient", () => {
  it("Workerは1個のみ生成され、同時に送られるリクエストは最大1件に制限される", () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createRasterConvertClient(createWorker);

    client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));
    client.enqueue(makeTask("c"));

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(workers[0].postMessageCalls).toHaveLength(1);
    expect(workers[0].postMessageCalls[0].id).toBe("a");
  });

  it("1件完了してから次のファイルが送信される", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));

    expect(worker.postMessageCalls).toHaveLength(1);

    worker.emit(doneMessage("a"));
    const outcome1 = await p1;

    expect(outcome1.status).toBe("done");
    expect(worker.postMessageCalls).toHaveLength(2);
    expect(worker.postMessageCalls[1].id).toBe("b");
  });

  it("sourceFormat・quality・backgroundがpostMessageへそのまま渡る", () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    client.enqueue(makeTask("a", "webp"));

    expect(worker.postMessageCalls[0].sourceFormat).toBe("webp");
    expect(worker.postMessageCalls[0].quality).toBe(0.8);
    expect(worker.postMessageCalls[0].background).toEqual(DEFAULT_RASTER_BACKGROUND);
  });

  it("unsupported-animationの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "unsupported-animation" });
    await expect(p1).resolves.toEqual({ status: "unsupported-animation" });
  });

  it("malformed-sourceの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "malformed-source" });
    await expect(p1).resolves.toEqual({ status: "malformed-source" });
  });

  it("unsafe-dimensionsの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "unsafe-dimensions" });
    await expect(p1).resolves.toEqual({ status: "unsafe-dimensions" });
  });

  it("input-too-large(AVIF専用)の結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a", "avif"));
    worker.emit({ id: "a", type: "result", status: "input-too-large" });
    await expect(p1).resolves.toEqual({ status: "input-too-large" });
  });

  it("dimension-mismatchの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "dimension-mismatch" });
    await expect(p1).resolves.toEqual({ status: "dimension-mismatch" });
  });

  it("unsupported-encoderの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "unsupported-encoder" });
    await expect(p1).resolves.toEqual({ status: "unsupported-encoder" });
  });

  it("timeoutの結果を正しく伝え、応答したWorkerをterminateする", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "timeout" });
    await expect(p1).resolves.toEqual({ status: "timeout" });
    expect(worker.terminated).toBe(true);
  });

  it("timeout後の次タスクは新しいWorkerで処理される", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createRasterConvertClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    workers[0].emit({ id: "a", type: "result", status: "timeout" });
    await p1;

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("cancelは待機中のタスクのみキューから除去し、cancelledで解決する(Workerはterminateしない)", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    client.enqueue(makeTask("a")); // 実行中になる
    const p2 = client.enqueue(makeTask("b")); // 待機中

    const removed = client.cancel("b");
    expect(removed).toBe(true);
    await expect(p2).resolves.toEqual({ status: "cancelled" });
    expect(worker.terminated).toBe(false);
  });

  it("cancelは実行中のタスクに対してWorkerをterminateし、cancelledで解決する", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createRasterConvertClient(createWorker);

    const p1 = client.enqueue(makeTask("a")); // 実行中

    const removed = client.cancel("a");
    expect(removed).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
    expect(workers[0].terminated).toBe(true);
  });

  it("cancelAllはWorkerをterminateし、待機中・実行中ともにcancelledで解決する", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a")); // 実行中
    const p2 = client.enqueue(makeTask("b")); // 待機中

    client.cancelAll();

    expect(worker.terminated).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
    await expect(p2).resolves.toEqual({ status: "cancelled" });
  });

  it("1件失敗しても後続ファイルの処理は続く", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    worker.emit({ id: "a", type: "result", status: "error", message: "失敗しました" });
    const outcome1 = await p1;
    expect(outcome1).toEqual({ status: "error", message: "失敗しました" });
    expect(worker.postMessageCalls).toHaveLength(2);

    worker.emit(doneMessage("b"));
    const outcome2 = await p2;
    expect(outcome2.status).toBe("done");
  });

  it("destroyはcancelAllと同じ効果を持つ", async () => {
    const worker = new FakeWorker();
    const client = createRasterConvertClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.destroy();

    expect(worker.terminated).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
  });
});
