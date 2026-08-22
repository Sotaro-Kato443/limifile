import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPngCompressionClient, detectPngCompressionSupport } from "./png-compression-client";
import type {
  PngCompressionWorkerRequestMessage,
  PngCompressionWorkerResultMessage,
} from "./png-compression.worker";
import type { PngCompressionWorkerLike } from "./png-compression-client";

class FakeWorker implements PngCompressionWorkerLike {
  postMessageCalls: PngCompressionWorkerRequestMessage[] = [];
  terminated = false;
  throwOnNextPostMessage: Error | null = null;
  private messageListeners: Array<
    (event: MessageEvent<PngCompressionWorkerResultMessage>) => void
  > = [];
  private errorListeners: Array<(event: ErrorEvent) => void> = [];
  private messageErrorListeners: Array<(event: MessageEvent) => void> = [];

  postMessage(message: PngCompressionWorkerRequestMessage): void {
    if (this.throwOnNextPostMessage) {
      const error = this.throwOnNextPostMessage;
      this.throwOnNextPostMessage = null;
      throw error;
    }
    this.postMessageCalls.push(message);
  }

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PngCompressionWorkerResultMessage>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEvent<PngCompressionWorkerResultMessage>) => void)
      | ((event: ErrorEvent) => void)
      | ((event: MessageEvent) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.push(
        listener as (event: MessageEvent<PngCompressionWorkerResultMessage>) => void,
      );
    } else if (type === "error") {
      this.errorListeners.push(listener as (event: ErrorEvent) => void);
    } else {
      this.messageErrorListeners.push(listener as (event: MessageEvent) => void);
    }
  }

  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<PngCompressionWorkerResultMessage>) => void,
  ): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEvent<PngCompressionWorkerResultMessage>) => void)
      | ((event: ErrorEvent) => void)
      | ((event: MessageEvent) => void),
  ): void {
    if (type === "message") {
      const target = listener as (event: MessageEvent<PngCompressionWorkerResultMessage>) => void;
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

  emit(data: PngCompressionWorkerResultMessage): void {
    for (const listener of [...this.messageListeners]) {
      listener({ data } as MessageEvent<PngCompressionWorkerResultMessage>);
    }
  }

  emitError(message = "boom"): ErrorEvent {
    const event = new ErrorEvent("error", { message, cancelable: true });
    for (const listener of [...this.errorListeners]) {
      listener(event);
    }
    return event;
  }

  emitMessageError(): void {
    for (const listener of [...this.messageErrorListeners]) {
      listener({} as MessageEvent);
    }
  }
}

function makeTask(id: string): { id: string; buffer: ArrayBuffer; targetBytes: number } {
  return { id, buffer: new ArrayBuffer(16), targetBytes: 1000 };
}

function doneMessage(id: string): PngCompressionWorkerResultMessage {
  return {
    id,
    type: "result",
    outcome: {
      status: "done",
      pngBuffer: new ArrayBuffer(80),
      pngType: "image/png",
      originalBytes: 1000,
      outputBytes: 80,
      originalWidth: 10,
      originalHeight: 10,
      outputWidth: 10,
      outputHeight: 10,
      colorCount: 2,
      encodeCount: 3,
      originalReturned: false,
    },
  };
}

// jsdom環境ではWorker/OffscreenCanvas/createImageBitmap/ImageDataが未定義のため、
// detectPngCompressionSupport()がtrueを返すよう最小限のグローバルをスタブする
function stubSupportedBrowserGlobals(): void {
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({}));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {};
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    },
  );
  vi.stubGlobal("ImageData", class {});
}

describe("detectPngCompressionSupport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Worker/createImageBitmap/OffscreenCanvas/ImageDataが揃っていればtrueを返す", () => {
    stubSupportedBrowserGlobals();
    expect(detectPngCompressionSupport()).toBe(true);
  });

  it("Workerが無ければfalseを返す", () => {
    stubSupportedBrowserGlobals();
    vi.stubGlobal("Worker", undefined);
    expect(detectPngCompressionSupport()).toBe(false);
  });

  it("OffscreenCanvas.prototype.convertToBlobが無ければfalseを返す", () => {
    stubSupportedBrowserGlobals();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return {};
        }
      },
    );
    expect(detectPngCompressionSupport()).toBe(false);
  });
});

describe("createPngCompressionClient", () => {
  beforeEach(() => {
    stubSupportedBrowserGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("非対応ブラウザではWorkerを生成せず、即座にunsupported-browserで解決する", async () => {
    vi.stubGlobal("Worker", undefined);
    const createWorker = vi.fn(() => new FakeWorker());
    const client = createPngCompressionClient(createWorker);
    const result = await client.enqueue(makeTask("a"));
    expect(result.status).toBe("unsupported-browser");
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("Workerは1個のみ生成され、同時リクエストは最大1件(FIFO)に制限される", () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createPngCompressionClient(createWorker);

    client.enqueue(makeTask("a"));
    client.enqueue(makeTask("b"));
    client.enqueue(makeTask("c"));

    expect(workers).toHaveLength(1);
    expect(workers[0].postMessageCalls).toHaveLength(1);
    expect(workers[0].postMessageCalls[0].id).toBe("a");
  });

  it("doneメッセージでresolveし、FIFOで次のタスクへ進む", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);

    const p1 = client.enqueue(makeTask("a"));
    worker.emit(doneMessage("a"));
    const result1 = await p1;
    expect(result1.status).toBe("done");

    const p2 = client.enqueue(makeTask("b"));
    expect(worker.postMessageCalls[1]?.id).toBe("b");
    worker.emit(doneMessage("b"));
    const result2 = await p2;
    expect(result2.status).toBe("done");
  });

  it("unreachable/animated-png/invalid-png/unsafe-dimensions等、任意のtyped statusをそのまま伝える", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", outcome: { status: "unsafe-dimensions" } });
    const result = await p;
    expect(result.status).toBe("unsafe-dimensions");
  });

  it("timeoutメッセージ受信時にWorkerをterminateする", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", outcome: { status: "timeout" } });
    const result = await p;
    expect(result.status).toBe("timeout");
    expect(worker.terminated).toBe(true);
  });

  it("timeout後、次のタスクは新しいWorkerで処理される", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createPngCompressionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    workers[0].emit({ id: "a", type: "result", outcome: { status: "timeout" } });
    await p1;

    const p2 = client.enqueue(makeTask("b"));
    expect(workers).toHaveLength(2);
    workers[1].emit(doneMessage("b"));
    expect((await p2).status).toBe("done");
  });

  it("クライアント側backstop(18秒)でもterminateしてtimeoutを返す", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p = client.enqueue(makeTask("a"));
    await vi.advanceTimersByTimeAsync(18000);
    const result = await p;
    expect(result.status).toBe("timeout");
    expect(worker.terminated).toBe(true);
  });

  it("cancel(id)は実行中タスクをcancelledで解決しWorkerをterminateする", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p = client.enqueue(makeTask("a"));
    const cancelled = client.cancel("a");
    expect(cancelled).toBe(true);
    expect(worker.terminated).toBe(true);
    const result = await p;
    expect(result.status).toBe("cancelled");
  });

  it("待機中タスクのcancelはWorkerをterminateせずキューから除去する", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));
    const cancelled = client.cancel("b");
    expect(cancelled).toBe(true);
    expect(worker.terminated).toBe(false);
    const result = await p2;
    expect(result.status).toBe("cancelled");
  });

  it("cancel後、次のタスクは新しいWorkerで処理される", async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const client = createPngCompressionClient(createWorker);

    const p1 = client.enqueue(makeTask("a"));
    client.cancel("a");
    await p1;

    const p2 = client.enqueue(makeTask("b"));
    expect(workers).toHaveLength(2);
    workers[1].emit(doneMessage("b"));
    expect((await p2).status).toBe("done");
  });

  it("存在しないidのcancelはfalseを返す", () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    expect(client.cancel("does-not-exist")).toBe(false);
  });

  it("cancelAllはキュー内・実行中の両方をcancelledで解決しWorkerをterminateする", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p1 = client.enqueue(makeTask("a"));
    const p2 = client.enqueue(makeTask("b"));
    client.cancelAll();
    expect((await p1).status).toBe("cancelled");
    expect((await p2).status).toBe("cancelled");
    expect(worker.terminated).toBe(true);
  });

  it("destroy()はcancelAllと同様に動作する", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p = client.enqueue(makeTask("a"));
    client.destroy();
    expect((await p).status).toBe("cancelled");
    expect(worker.terminated).toBe(true);
  });

  it("Workerのerrorイベントはevent.preventDefaultされ、terminateしてerrorで解決する", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p = client.enqueue(makeTask("a"));
    const event = worker.emitError("boom");
    expect(event.defaultPrevented).toBe(true);
    const result = await p;
    expect(result.status).toBe("error");
    expect(worker.terminated).toBe(true);
  });

  it("messageerrorイベントはterminateしてerrorで解決する", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p = client.enqueue(makeTask("a"));
    worker.emitMessageError();
    const result = await p;
    expect(result.status).toBe("error");
    expect(worker.terminated).toBe(true);
  });

  it("createWorkerが同期的にthrowした場合、errorで解決し次タスクへ進む", async () => {
    const createWorker = vi.fn(() => {
      throw new Error("worker init failed");
    });
    const client = createPngCompressionClient(createWorker);
    const result = await client.enqueue(makeTask("a"));
    expect(result.status).toBe("error");
  });

  it("addEventListenerが同期的にthrowした場合もerrorで解決される", async () => {
    class ThrowingWorker extends FakeWorker {
      addEventListener(): void {
        throw new Error("addEventListener failed");
      }
    }
    const worker = new ThrowingWorker();
    const client = createPngCompressionClient(() => worker);
    const result = await client.enqueue(makeTask("a"));
    expect(result.status).toBe("error");
  });

  it("postMessageが同期的にthrowした場合、terminateしてerrorで解決する", async () => {
    const worker = new FakeWorker();
    worker.throwOnNextPostMessage = new Error("post failed");
    const client = createPngCompressionClient(() => worker);
    const result = await client.enqueue(makeTask("a"));
    expect(result.status).toBe("error");
    expect(worker.terminated).toBe(true);
  });

  it("terminate後に届く古いWorkerからの遅延メッセージは無視される(二重resolve防止)", async () => {
    const worker = new FakeWorker();
    const client = createPngCompressionClient(() => worker);
    const p = client.enqueue(makeTask("a"));
    worker.emit({ id: "a", type: "result", outcome: { status: "timeout" } });
    worker.emit(doneMessage("a")); // 古いWorkerからの遅延done(無視されるべき)
    const result = await p;
    expect(result.status).toBe("timeout");
  });
});
