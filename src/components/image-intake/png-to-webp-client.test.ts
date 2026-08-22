import { describe, expect, it, vi } from "vitest";
import { createPngToWebpClient } from "./png-to-webp-client";
import type {
  PngToWebpWorkerRequestMessage,
  PngToWebpWorkerResultMessage,
} from "./png-to-webp.worker";
import type { PngToWebpWorkerLike } from "./png-to-webp-client";

class FakeWorker implements PngToWebpWorkerLike {
  postMessageCalls: PngToWebpWorkerRequestMessage[] = [];
  terminated = false;
  private listeners: Array<(event: MessageEvent<PngToWebpWorkerResultMessage>) => void> = [];

  postMessage(message: PngToWebpWorkerRequestMessage): void {
    this.postMessageCalls.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<PngToWebpWorkerResultMessage>) => void,
  ): void {
    this.listeners.push(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<PngToWebpWorkerResultMessage>) => void,
  ): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: PngToWebpWorkerResultMessage): void {
    for (const listener of [...this.listeners]) {
      listener({ data } as MessageEvent<PngToWebpWorkerResultMessage>);
    }
  }
}

function makeTask(id: string): { id: string; buffer: ArrayBuffer; quality: number } {
  return { id, buffer: new ArrayBuffer(4), quality: 0.8 };
}

function doneMessage(id: string): PngToWebpWorkerResultMessage {
  return {
    id,
    type: "result",
    status: "done",
    webpBuffer: new ArrayBuffer(4),
    width: 100,
    height: 100,
    quality: 0.8,
    elapsedMs: 10,
  };
}

describe("createPngToWebpClient", () => {
  it("Workerは1個のみ生成され、同時に送られるリクエストは最大1件に制限される", () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createPngToWebpClient(createWorker);

    client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));
    client.enqueue(makeTask("c"));

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(workers[0].postMessageCalls).toHaveLength(1);
    expect(workers[0].postMessageCalls[0].id).toBe("a");
  });

  it("1件完了してから次のファイルが送信される", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));

    expect(worker.postMessageCalls).toHaveLength(1);

    worker.emit(doneMessage("a"));
    const outcome1 = await p1;

    expect(outcome1.status).toBe("done");
    expect(worker.postMessageCalls).toHaveLength(2);
    expect(worker.postMessageCalls[1].id).toBe("b");
  });

  it("quality値がpostMessageへそのまま渡る", () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

    client.enqueue({ id: "a", buffer: new ArrayBuffer(4), quality: 0.65 });

    expect(worker.postMessageCalls[0].quality).toBe(0.65);
  });

  it("unsupported-animationの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "unsupported-animation" });
    await expect(p1).resolves.toEqual({ status: "unsupported-animation" });
  });

  it("malformed-pngの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "malformed-png" });
    await expect(p1).resolves.toEqual({ status: "malformed-png" });
  });

  it("unsafe-dimensionsの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "unsafe-dimensions" });
    await expect(p1).resolves.toEqual({ status: "unsafe-dimensions" });
  });

  it("dimension-mismatchの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "dimension-mismatch" });
    await expect(p1).resolves.toEqual({ status: "dimension-mismatch" });
  });

  it("unsupported-webp-encoderの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "unsupported-webp-encoder" });
    await expect(p1).resolves.toEqual({ status: "unsupported-webp-encoder" });
  });

  it("timeoutの結果を正しく伝え、応答したWorkerをterminateする", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "timeout" });
    await expect(p1).resolves.toEqual({ status: "timeout" });
    expect(worker.terminated).toBe(true);
  });

  it("timeout後、terminateは1回だけ呼ばれる", async () => {
    const worker = new FakeWorker();
    const terminateSpy = vi.spyOn(worker, "terminate");
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", status: "timeout" });
    await p1;

    expect(terminateSpy).toHaveBeenCalledTimes(1);
  });

  it("timeout後の次タスクは新しいWorkerで処理される", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createPngToWebpClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    workers[0].emit({ id: "a", type: "result", status: "timeout" });
    await p1;

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("timeout後も次タスクは正常完了する", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createPngToWebpClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    workers[0].emit({ id: "a", type: "result", status: "timeout" });
    await expect(p1).resolves.toEqual({ status: "timeout" });

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("timeoutでterminateされた古いWorkerからの遅延メッセージは無視される", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createPngToWebpClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    workers[0].emit({ id: "a", type: "result", status: "timeout" });
    await expect(p1).resolves.toEqual({ status: "timeout" });

    // 古いWorker(terminate済み)から遅延してdoneが届いても、現在の状態には反映されない
    workers[0].emit(doneMessage("a"));
    await Promise.resolve();

    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("cancelとtimeoutが競合しても二重resolveしない", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createPngToWebpClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const resolveSpy = vi.fn();
    p1.then(resolveSpy);

    // cancelが先にactiveEntryを解決・Workerをterminateする
    const removed = client.cancel("a");
    expect(removed).toBe(true);

    // その後にWorkerからtimeout結果が届いても、二重にresolveされない(無視される)
    workers[0].emit({ id: "a", type: "result", status: "timeout" });
    await Promise.resolve();
    await Promise.resolve();

    await expect(p1).resolves.toEqual({ status: "cancelled" });
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it("1件失敗しても後続ファイルの処理は続く", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

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

  it("cancelは待機中のタスクのみキューから除去し、cancelledで解決する(Workerはterminateしない)", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

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
    const client = createPngToWebpClient(createWorker);

    const p1 = client.enqueue(makeTask("a")); // 実行中

    const removed = client.cancel("a");
    expect(removed).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
    expect(workers[0].terminated).toBe(true);
  });

  it("cancelAllはWorkerをterminateし、待機中・実行中ともにcancelledで解決する", async () => {
    const worker = new FakeWorker();
    const client = createPngToWebpClient(() => worker);

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
    const client = createPngToWebpClient(createWorker);

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
    const client = createPngToWebpClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.destroy();

    expect(worker.terminated).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
  });
});
