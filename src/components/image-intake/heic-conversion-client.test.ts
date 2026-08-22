import { afterEach, describe, expect, it, vi } from "vitest";
import { createHeicConversionClient } from "./heic-conversion-client";
import type { HeicConvertRequestMessage, HeicConvertResultMessage } from "./heic-convert.worker";
import type { HeicWorkerLike } from "./heic-conversion-client";

class FakeWorker implements HeicWorkerLike {
  postMessageCalls: HeicConvertRequestMessage[] = [];
  terminated = false;
  /** テスト用: 次回のpostMessage呼び出しで同期的にthrowさせる */
  throwOnNextPostMessage: Error | null = null;
  private messageListeners: Array<(event: MessageEvent<HeicConvertResultMessage>) => void> = [];
  private errorListeners: Array<(event: ErrorEvent) => void> = [];
  private messageErrorListeners: Array<(event: MessageEvent) => void> = [];

  postMessage(message: HeicConvertRequestMessage): void {
    if (this.throwOnNextPostMessage) {
      const error = this.throwOnNextPostMessage;
      this.throwOnNextPostMessage = null;
      throw error;
    }
    this.postMessageCalls.push(message);
  }

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<HeicConvertResultMessage>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEvent<HeicConvertResultMessage>) => void)
      | ((event: ErrorEvent) => void)
      | ((event: MessageEvent) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.push(
        listener as (event: MessageEvent<HeicConvertResultMessage>) => void,
      );
    } else if (type === "error") {
      this.errorListeners.push(listener as (event: ErrorEvent) => void);
    } else {
      this.messageErrorListeners.push(listener as (event: MessageEvent) => void);
    }
  }

  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<HeicConvertResultMessage>) => void,
  ): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEvent<HeicConvertResultMessage>) => void)
      | ((event: ErrorEvent) => void)
      | ((event: MessageEvent) => void),
  ): void {
    if (type === "message") {
      const target = listener as (event: MessageEvent<HeicConvertResultMessage>) => void;
      this.messageListeners = this.messageListeners.filter((l) => l !== target);
    } else if (type === "error") {
      const target = listener as (event: ErrorEvent) => void;
      this.errorListeners = this.errorListeners.filter((l) => l !== target);
    } else {
      const target = listener as (event: MessageEvent) => void;
      this.messageErrorListeners = this.messageErrorListeners.filter((l) => l !== target);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  /** テスト用: Workerからの応答をシミュレートする */
  emit(data: HeicConvertResultMessage): void {
    for (const listener of [...this.messageListeners]) {
      listener({ data } as MessageEvent<HeicConvertResultMessage>);
    }
  }

  /**
   * テスト用: Workerの"error"イベントをシミュレートする。cancelableな実ErrorEventを使い、
   * onError側のevent.preventDefault()が呼ばれたかをevent.defaultPreventedで検証できるようにする。
   */
  emitError(message = "boom"): ErrorEvent {
    const event = new ErrorEvent("error", { message, cancelable: true });
    for (const listener of [...this.errorListeners]) {
      listener(event);
    }
    return event;
  }

  /** テスト用: Workerの"messageerror"イベントをシミュレートする */
  emitMessageError(): void {
    for (const listener of [...this.messageErrorListeners]) {
      listener({} as MessageEvent);
    }
  }
}

function makeTask(id: string): { id: string; buffer: ArrayBuffer; quality: number } {
  return { id, buffer: new ArrayBuffer(4), quality: 0.8 };
}

function doneMessage(id: string): HeicConvertResultMessage {
  return {
    id,
    status: "done",
    jpegBuffer: new ArrayBuffer(4),
    jpegType: "image/jpeg",
    width: 10,
    height: 10,
  };
}

function errorMessage(id: string, message = "Decoding error"): HeicConvertResultMessage {
  return { id, status: "error", message };
}

describe("createHeicConversionClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Workerは1個のみ生成され、同時に送られるリクエストは最大1件に制限される", () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));
    client.enqueue(makeTask("c"));

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(workers[0].postMessageCalls).toHaveLength(1);
    expect(workers[0].postMessageCalls[0].id).toBe("a");
  });

  it("1件完了してから次のファイルが送信される", async () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));

    expect(worker.postMessageCalls).toHaveLength(1);

    worker.emit(doneMessage("a"));
    const outcome1 = await p1;

    expect(outcome1.status).toBe("done");
    expect(worker.postMessageCalls).toHaveLength(2);
    expect(worker.postMessageCalls[1].id).toBe("b");
  });

  it("1件失敗しても後続ファイルの処理は続く", async () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    worker.emit(errorMessage("a"));
    const outcome1 = await p1;
    expect(outcome1).toEqual({ status: "error", message: "Decoding error" });
    expect(worker.postMessageCalls).toHaveLength(2);

    worker.emit(doneMessage("b"));
    const outcome2 = await p2;
    expect(outcome2.status).toBe("done");
  });

  it("invalid-quality/unsafe-dimensions/unsupported-jpeg-encoderの結果を正しく伝える", async () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", status: "invalid-quality" });
    await expect(p1).resolves.toEqual({ status: "invalid-quality" });

    const p2 = client.enqueue(makeTask("b"));
    worker.emit({ id: "b", status: "unsafe-dimensions" });
    await expect(p2).resolves.toEqual({ status: "unsafe-dimensions" });

    const p3 = client.enqueue(makeTask("c"));
    worker.emit({ id: "c", status: "unsupported-jpeg-encoder" });
    await expect(p3).resolves.toEqual({ status: "unsupported-jpeg-encoder" });
  });

  it("cancelは待機中のタスクのみキューから除去し、cancelledで解決する(Workerはterminateしない)", async () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    client.enqueue(makeTask("a")); // 実行中になる
    const p2 = client.enqueue(makeTask("b")); // 待機中

    const removed = client.cancel("b");
    expect(removed).toBe(true);
    await expect(p2).resolves.toEqual({ status: "cancelled" });
    expect(worker.terminated).toBe(false);
  });

  it("cancelは実行中のタスクに対してWorkerをterminateし、cancelledで解決する(terminateは1回)", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a")); // 実行中
    const terminateSpy = vi.spyOn(workers[0], "terminate");

    const removed = client.cancel("a");
    expect(removed).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
    expect(workers[0].terminated).toBe(true);
    expect(terminateSpy).toHaveBeenCalledTimes(1);
  });

  it("cancelは既に完了済み・存在しないIDに対してfalseを返す", () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    client.enqueue(makeTask("a"));
    expect(client.cancel("does-not-exist")).toBe(false);
  });

  it("実行中cancel後、次タスクは新しいWorkerで正常に処理される", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    client.enqueue(makeTask("a")); // worker[0]で実行中
    client.cancel("a"); // worker[0]をterminate

    const p2 = client.enqueue(makeTask("b")); // worker[1]が新規生成され実行中
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("cancelAllはWorkerをterminateし、待機中・実行中ともにcancelledで解決する", async () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a")); // 実行中
    const p2 = client.enqueue(makeTask("b")); // 待機中

    client.cancelAll();

    expect(worker.terminated).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
    await expect(p2).resolves.toEqual({ status: "cancelled" });
  });

  it("terminate後に新しいタスクをenqueueすると新しいWorkerが生成される", () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    client.enqueue(makeTask("a"));
    client.cancelAll();
    client.enqueue(makeTask("b"));

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].postMessageCalls[0].id).toBe("b");
  });

  it("古いWorkerからの遅延結果は現在の状態へ反映されない", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

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
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    client.destroy();

    expect(worker.terminated).toBe(true);
    await expect(p1).resolves.toEqual({ status: "cancelled" });
  });

  it("Workerからのtimeout結果を受け取ると、応答したWorkerをterminateする", async () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", status: "timeout" });
    await expect(p1).resolves.toEqual({ status: "timeout" });
    expect(worker.terminated).toBe(true);
  });

  it("Worker timeout後、次タスクは新しいWorkerで正常に完了する", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    workers[0].emit({ id: "a", status: "timeout" });
    await expect(p1).resolves.toEqual({ status: "timeout" });

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("クライアント側バックストップタイムアウト(35秒)が発火するとWorkerをterminateし、timeoutで解決する", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    // Worker自身からは一切応答が来ないままクライアント側タイムアウトのみ発火する状況を再現
    await vi.advanceTimersByTimeAsync(35000);

    await expect(p1).resolves.toEqual({ status: "timeout" });
    expect(workers[0].terminated).toBe(true);
  });

  it("クライアント側タイムアウト後、次タスクは新しいWorkerで正常に完了する", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    await vi.advanceTimersByTimeAsync(35000);
    await expect(p1).resolves.toEqual({ status: "timeout" });

    const p2 = client.enqueue(makeTask("b"));
    expect(createWorker).toHaveBeenCalledTimes(2);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("古いWorkerからの遅延メッセージ(timeout terminate後)は現在の状態へ反映されない", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    workers[0].emit({ id: "a", status: "timeout" });
    await expect(p1).resolves.toEqual({ status: "timeout" });

    // 古いworker[0](terminate済み)から遅延してdoneが届いても、現在の状態には反映されない
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
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const resolveSpy = vi.fn();
    p1.then(resolveSpy);

    // cancelが先にactiveEntryを解決・Workerをterminateする
    const removed = client.cancel("a");
    expect(removed).toBe(true);

    // その後にWorkerからtimeout結果が届いても、二重にresolveされない(無視される)
    workers[0].emit({ id: "a", status: "timeout" });
    await Promise.resolve();
    await Promise.resolve();

    await expect(p1).resolves.toEqual({ status: "cancelled" });
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it("Workerの'error'イベントを受け取ると、現在のWorkerをterminateしerrorで解決する", async () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emitError("unexpected worker crash");

    const outcome = await p1;
    expect(outcome.status).toBe("error");
    expect(worker.terminated).toBe(true);
  });

  it("Worker'error'後、次タスクは新しいWorkerで正常に処理される", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    workers[0].emitError("boom");
    await expect(p1).resolves.toMatchObject({ status: "error" });

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("Workerの'messageerror'イベントを受け取ると、現在のWorkerをterminateしerrorで解決する", async () => {
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emitMessageError();

    const outcome = await p1;
    expect(outcome.status).toBe("error");
    expect(worker.terminated).toBe(true);
  });

  it("cancelAllは待機中タスクのバックストップタイマーも含めすべて解除する", () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    client.enqueue(makeTask("a"));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    client.cancelAll();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("destroyはタイマーもすべて解除する", () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    client.enqueue(makeTask("a"));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    client.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("正常終了時もバックストップタイマーを解除する(タイマーリークがない)", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit(doneMessage("a"));
    await p1;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("エラー終了時もバックストップタイマーを解除する(タイマーリークがない)", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit(errorMessage("a"));
    await p1;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("Worker'error'イベントはpreventDefaultが1回呼ばれ、現在タスクはerrorで解決、Workerはterminateされ、次タスクは新Workerで成功する", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    const event = workers[0].emitError("unexpected worker crash");
    expect(event.defaultPrevented).toBe(true);

    await expect(p1).resolves.toMatchObject({ status: "error" });
    expect(workers[0].terminated).toBe(true);

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);
    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("古いWorkerからの'error'イベントであってもpreventDefaultは呼ばれる(staleでも抑止する)", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    client.enqueue(makeTask("a")); // worker[0]で実行中
    client.cancelAll(); // worker[0]をterminate、以後のerrorイベントはstale扱い

    // staleなworker[0]からの遅延errorイベントでもpreventDefaultは呼ばれる
    const event = workers[0].emitError("stale crash");
    expect(event.defaultPrevented).toBe(true);
  });

  it("createWorker()が同期的にthrowした場合、1件目はerrorで解決し、2件目は新しいWorkerで正常完了する(キューは停止しない)", async () => {
    const workers: FakeWorker[] = [];
    let callCount = 0;
    const createWorker = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("Worker生成に失敗しました");
      }
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    await expect(p1).resolves.toMatchObject({ status: "error" });

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers).toHaveLength(1);
    expect(workers[0].postMessageCalls.map((m) => m.id)).toEqual(["b"]);

    workers[0].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("createWorker()が同期的にthrowしてもタイマーは残らない", async () => {
    vi.useFakeTimers();
    const createWorker = vi.fn(() => {
      throw new Error("Worker生成に失敗しました");
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    await expect(p1).resolves.toMatchObject({ status: "error" });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("postMessage()が同期的にthrowした場合、1件目はerrorで解決しWorkerはterminateされ、2件目は新Workerで正常完了する", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      // 最初に生成されるWorker(1件目用)だけ、postMessage時に同期throwさせる
      if (workers.length === 1) {
        w.throwOnNextPostMessage = new Error("postMessageに失敗しました");
      }
      return w;
    });
    const client = createHeicConversionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));

    await expect(p1).resolves.toMatchObject({ status: "error" });
    expect(workers[0].terminated).toBe(true);

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].postMessageCalls.map((m) => m.id)).toEqual(["b"]);
    workers[1].emit(doneMessage("b"));
    await expect(p2).resolves.toMatchObject({ status: "done" });
  });

  it("postMessage()が同期的にthrowしてもタイマーは残らない", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    worker.throwOnNextPostMessage = new Error("postMessageに失敗しました");
    const client = createHeicConversionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    await expect(p1).resolves.toMatchObject({ status: "error" });

    expect(vi.getTimerCount()).toBe(0);
  });
});
