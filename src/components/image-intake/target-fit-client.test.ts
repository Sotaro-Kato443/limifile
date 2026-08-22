import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import { createTargetFitClient } from "./target-fit-client";
import type { TargetFitWorkerLike } from "./target-fit-client";
import type {
  TargetFitWorkerRequestMessage,
  TargetFitWorkerResultMessage,
} from "./target-fit.worker";

class FakeWorker implements TargetFitWorkerLike {
  postMessageCalls: TargetFitWorkerRequestMessage[] = [];
  terminated = false;
  private listeners: Array<(event: MessageEvent<TargetFitWorkerResultMessage>) => void> = [];

  postMessage(message: TargetFitWorkerRequestMessage): void {
    this.postMessageCalls.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<TargetFitWorkerResultMessage>) => void,
  ): void {
    this.listeners.push(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<TargetFitWorkerResultMessage>) => void,
  ): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: TargetFitWorkerResultMessage): void {
    for (const listener of [...this.listeners]) {
      listener({ data } as MessageEvent<TargetFitWorkerResultMessage>);
    }
  }
}

function makeTask(id: string): TargetFitWorkerRequestMessage {
  return {
    id,
    buffer: new ArrayBuffer(4),
    sourceFormat: "png",
    targetWidth: 200,
    targetHeight: 100,
    maxBytes: 50_000,
    fitMode: "contain",
    background: DEFAULT_RASTER_BACKGROUND,
  };
}

function doneMessage(id: string): TargetFitWorkerResultMessage {
  return {
    id,
    type: "result",
    status: "done",
    candidate: {
      jpegBuffer: new ArrayBuffer(4),
      width: 200,
      height: 100,
      quality: 0.8,
      bytes: 40_000,
      mimeType: "image/jpeg",
      upscaled: false,
    },
    encodeCount: 3,
    elapsedMs: 10,
  };
}

function unreachableMessage(id: string): TargetFitWorkerResultMessage {
  return {
    id,
    type: "result",
    status: "unreachable",
    bestCandidate: {
      jpegBuffer: new ArrayBuffer(4),
      width: 200,
      height: 100,
      quality: 0.35,
      bytes: 60_000,
      mimeType: "image/jpeg",
      upscaled: false,
    },
    encodeCount: 9,
    elapsedMs: 50,
  };
}

function errorMessage(id: string, message = "処理に失敗しました"): TargetFitWorkerResultMessage {
  return { id, type: "result", status: "error", message };
}

describe("createTargetFitClient", () => {
  it("Workerは1個のみ生成され、同時に送られるリクエストは最大1件に制限される", () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createTargetFitClient(createWorker);

    client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));
    client.enqueue(makeTask("c"));

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(workers[0].postMessageCalls).toHaveLength(1);
    expect(workers[0].postMessageCalls[0].id).toBe("a");
  });

  it("1件完了してから次のファイルが送信される", async () => {
    const worker = new FakeWorker();
    const client = createTargetFitClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));

    expect(worker.postMessageCalls).toHaveLength(1);

    worker.emit(doneMessage("a"));
    const outcome1 = await p1;

    expect(outcome1.status).toBe("done");
    expect(worker.postMessageCalls).toHaveLength(2);
    expect(worker.postMessageCalls[1].id).toBe("b");
  });

  it("onStartはenqueue時(dequeueされた瞬間)に同期的に呼ばれる", () => {
    const worker = new FakeWorker();
    const client = createTargetFitClient(() => worker);
    const onStart = vi.fn();

    client.enqueue(makeTask("a"), { onStart });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("達成不能(unreachable)の結果をbestCandidate込みで正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createTargetFitClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit(unreachableMessage("a"));
    const outcome = await p1;

    expect(outcome).toEqual({
      status: "unreachable",
      bestCandidate: expect.objectContaining({ bytes: 60_000, quality: 0.35 }),
      encodeCount: 9,
      elapsedMs: 50,
    });
  });

  it("1件失敗しても後続ファイルの処理は続く", async () => {
    const worker = new FakeWorker();
    const client = createTargetFitClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    worker.emit(errorMessage("a"));
    const outcome1 = await p1;
    expect(outcome1).toEqual({ status: "error", message: "処理に失敗しました" });
    expect(worker.postMessageCalls).toHaveLength(2);

    worker.emit(doneMessage("b"));
    const outcome2 = await p2;
    expect(outcome2.status).toBe("done");
  });

  it("cancelは待機中のタスクのみキューから除去し、cancelledで解決する(Workerはterminateしない)", async () => {
    const worker = new FakeWorker();
    const client = createTargetFitClient(() => worker);

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
    const client = createTargetFitClient(createWorker);

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
    const client = createTargetFitClient(createWorker);

    client.enqueue(makeTask("a"));
    client.cancel("a");
    const p2 = client.enqueue(makeTask("b"));

    expect(createWorker).toHaveBeenCalledTimes(2);
    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("存在しないidをcancelしてもfalseを返す", () => {
    const worker = new FakeWorker();
    const client = createTargetFitClient(() => worker);
    expect(client.cancel("does-not-exist")).toBe(false);
  });

  it("cancelAllはWorkerをterminateし、待機中・実行中ともにcancelledで解決する", async () => {
    const worker = new FakeWorker();
    const client = createTargetFitClient(() => worker);

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
    const client = createTargetFitClient(createWorker);

    client.enqueue(makeTask("a")); // worker[0]で実行中
    client.cancelAll(); // worker[0]をterminate、aはcancelledで解決済み

    const p2 = client.enqueue(makeTask("b")); // worker[1]が新規生成され実行中

    workers[0].emit(doneMessage("a"));
    await Promise.resolve();

    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("destroyはcancelAllと同じ効果を持つ", async () => {
    const worker = new FakeWorker();
    const client = createTargetFitClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.destroy();

    expect(worker.terminated).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
  });
});
