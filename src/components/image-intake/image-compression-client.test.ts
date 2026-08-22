import { describe, expect, it, vi } from "vitest";
import { createCompressionClient } from "./image-compression-client";
import type {
  CompressWorkerProgressMessage,
  CompressWorkerRequestMessage,
  CompressWorkerResultMessage,
} from "./image-compress.worker";
import type { CompressWorkerLike } from "./image-compression-client";

type AnyWorkerMessage = CompressWorkerResultMessage | CompressWorkerProgressMessage;

class FakeWorker implements CompressWorkerLike {
  postMessageCalls: CompressWorkerRequestMessage[] = [];
  terminated = false;
  private listeners: Array<(event: MessageEvent<AnyWorkerMessage>) => void> = [];

  postMessage(message: CompressWorkerRequestMessage): void {
    this.postMessageCalls.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<AnyWorkerMessage>) => void,
  ): void {
    this.listeners.push(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<AnyWorkerMessage>) => void,
  ): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: AnyWorkerMessage): void {
    for (const listener of [...this.listeners]) {
      listener({ data } as MessageEvent<AnyWorkerMessage>);
    }
  }
}

function makeTask(id: string): { id: string; buffer: ArrayBuffer; targetBytes: number } {
  return { id, buffer: new ArrayBuffer(4), targetBytes: 50_000 };
}

function doneMessage(id: string): CompressWorkerResultMessage {
  return {
    id,
    type: "result",
    status: "done",
    jpegBuffer: new ArrayBuffer(4),
    width: 100,
    height: 100,
    quality: 0.8,
    encodeCount: 1,
    resizeCount: 0,
    elapsedMs: 10,
  };
}

function unreachableMessage(id: string): CompressWorkerResultMessage {
  return {
    id,
    type: "result",
    status: "unreachable",
    encodeCount: 12,
    resizeCount: 3,
    elapsedMs: 100,
  };
}

function errorMessage(id: string, message = "圧縮に失敗しました"): CompressWorkerResultMessage {
  return { id, type: "result", status: "error", message };
}

function webpDoneMessage(id: string): CompressWorkerResultMessage {
  return {
    id,
    type: "result",
    status: "webp-done",
    webpBuffer: new ArrayBuffer(4),
    width: 100,
    height: 100,
    quality: 0.6,
    encodeCount: 2,
    resizeCount: 0,
    elapsedMs: 20,
  };
}

function unsafeDimensionsMessage(id: string): CompressWorkerResultMessage {
  return { id, type: "result", status: "unsafe-dimensions" };
}

function unsupportedWebpEncoderMessage(id: string): CompressWorkerResultMessage {
  return { id, type: "result", status: "unsupported-webp-encoder" };
}

describe("createCompressionClient", () => {
  it("Workerは1個のみ生成され、同時に送られるリクエストは最大1件に制限される", () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createCompressionClient(createWorker);

    client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));
    client.enqueue(makeTask("c"));

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(workers[0].postMessageCalls).toHaveLength(1);
    expect(workers[0].postMessageCalls[0].id).toBe("a");
  });

  it("1件完了してから次のファイルが送信される", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));

    expect(worker.postMessageCalls).toHaveLength(1);

    worker.emit(doneMessage("a"));
    const outcome1 = await p1;

    expect(outcome1.status).toBe("done");
    expect(worker.postMessageCalls).toHaveLength(2);
    expect(worker.postMessageCalls[1].id).toBe("b");
  });

  it("進捗メッセージはonProgressへ転送され、キューは解決されない", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);
    const onProgress = vi.fn();

    const p1 = client.enqueue(makeTask("a"), { onProgress });

    worker.emit({ id: "a", type: "progress", phase: "quality", attempt: 1, maxAttempts: 12 });
    worker.emit({ id: "a", type: "progress", phase: "resize", attempt: 5, maxAttempts: 12 });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      phase: "quality",
      attempt: 1,
      maxAttempts: 12,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, { phase: "resize", attempt: 5, maxAttempts: 12 });

    worker.emit(doneMessage("a"));
    await expect(p1).resolves.toMatchObject({ status: "done" });
  });

  it("達成不能(unreachable)の結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit(unreachableMessage("a"));
    const outcome = await p1;

    expect(outcome).toEqual({
      status: "unreachable",
      encodeCount: 12,
      resizeCount: 3,
      elapsedMs: 100,
    });
  });

  it("1件失敗しても後続ファイルの処理は続く", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    worker.emit(errorMessage("a"));
    const outcome1 = await p1;
    expect(outcome1).toEqual({ status: "error", message: "圧縮に失敗しました" });
    expect(worker.postMessageCalls).toHaveLength(2);

    worker.emit(doneMessage("b"));
    const outcome2 = await p2;
    expect(outcome2.status).toBe("done");
  });

  it("cancelは待機中のタスクのみキューから除去し、cancelledで解決する(Workerはterminateしない)", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    client.enqueue(makeTask("a")); // 実行中になる
    const p2 = client.enqueue(makeTask("b")); // 待機中

    const removed = client.cancel("b");
    expect(removed).toBe(true);
    await expect(p2).resolves.toEqual({ status: "cancelled" });
    expect(worker.terminated).toBe(false);

    worker.emit(doneMessage("a"));
    await Promise.resolve();
    expect(worker.postMessageCalls.map((m) => m.id)).toEqual(["a"]);
  });

  it("cancelは実行中のタスクに対してWorkerをterminateし、cancelledで解決する", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createCompressionClient(createWorker);

    const p1 = client.enqueue(makeTask("a")); // 実行中

    const removed = client.cancel("a");
    expect(removed).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
    expect(workers[0].terminated).toBe(true);
  });

  it("実行中タスクのキャンセル後、新しいタスクは新しいWorkerで開始される", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createCompressionClient(createWorker);

    client.enqueue(makeTask("a"));
    client.cancel("a");
    const p2 = client.enqueue(makeTask("b"));

    expect(createWorker).toHaveBeenCalledTimes(2);
    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("存在しないidをcancelしてもfalseを返す", () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);
    expect(client.cancel("does-not-exist")).toBe(false);
  });

  it("cancelAllはWorkerをterminateし、待機中・実行中ともにcancelledで解決する", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    const p1 = client.enqueue(makeTask("a")); // 実行中
    const p2 = client.enqueue(makeTask("b")); // 待機中

    client.cancelAll();

    expect(worker.terminated).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
    await expect(p2).resolves.toEqual({ status: "cancelled" });
  });

  it("古いWorkerからの遅延結果は現在の状態へ反映されない", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createCompressionClient(createWorker);

    client.enqueue(makeTask("a")); // worker[0]で実行中
    client.cancelAll(); // worker[0]をterminate、aはcancelledで解決済み

    const p2 = client.enqueue(makeTask("b")); // worker[1]が新規生成され実行中

    workers[0].emit(doneMessage("a"));
    await Promise.resolve();

    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("webp-doneの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    const p1 = client.enqueue({ ...makeTask("a"), format: "webp" });
    worker.emit(webpDoneMessage("a"));
    const outcome = await p1;

    expect(outcome).toEqual({
      status: "webp-done",
      webpBuffer: expect.any(ArrayBuffer),
      width: 100,
      height: 100,
      quality: 0.6,
      encodeCount: 2,
      resizeCount: 0,
      elapsedMs: 20,
    });
  });

  it("unsafe-dimensionsの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit(unsafeDimensionsMessage("a"));
    const outcome = await p1;

    expect(outcome).toEqual({ status: "unsafe-dimensions" });
  });

  it("unsupported-webp-encoderの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    const p1 = client.enqueue({ ...makeTask("a"), format: "webp" });
    worker.emit(unsupportedWebpEncoderMessage("a"));
    const outcome = await p1;

    expect(outcome).toEqual({ status: "unsupported-webp-encoder" });
  });

  it("formatを指定するとWorkerへのpostMessageにそのまま渡る", () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    client.enqueue({ ...makeTask("a"), format: "webp" });

    expect(worker.postMessageCalls[0].format).toBe("webp");
  });

  it("formatを省略した場合、Workerへのformatはundefined(既定でjpeg扱い)になる", () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    client.enqueue(makeTask("a"));

    expect(worker.postMessageCalls[0].format).toBeUndefined();
  });

  it("destroyはcancelAllと同じ効果を持つ", async () => {
    const worker = new FakeWorker();
    const client = createCompressionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.destroy();

    expect(worker.terminated).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
  });
});
