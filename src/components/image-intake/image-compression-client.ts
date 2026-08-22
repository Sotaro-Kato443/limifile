import type {
  CompressionPhase,
  CompressWorkerProgressMessage,
  CompressWorkerRequestMessage,
  CompressWorkerResultMessage,
} from "./image-compress.worker";

export interface CompressTask {
  id: string;
  buffer: ArrayBuffer;
  targetBytes: number;
  /** 省略時は既存呼び出しと完全互換のため"jpeg"として扱う */
  format?: "jpeg" | "webp";
}

export type CompressOutcome =
  | {
      status: "done";
      jpegBuffer: ArrayBuffer;
      width: number;
      height: number;
      quality: number;
      encodeCount: number;
      resizeCount: number;
      elapsedMs: number;
    }
  | {
      status: "webp-done";
      webpBuffer: ArrayBuffer;
      width: number;
      height: number;
      quality: number;
      encodeCount: number;
      resizeCount: number;
      elapsedMs: number;
    }
  | { status: "unreachable"; encodeCount: number; resizeCount: number; elapsedMs: number }
  | { status: "error"; message: string }
  | { status: "unsafe-dimensions" }
  | { status: "unsupported-webp-encoder" }
  | { status: "unsupported-animation" }
  | { status: "malformed-webp" }
  | { status: "dimension-mismatch" }
  | { status: "cancelled" };

export interface CompressProgress {
  phase: CompressionPhase;
  attempt: number;
  maxAttempts: number;
}

type CompressWorkerMessage = CompressWorkerResultMessage | CompressWorkerProgressMessage;

/** Workerの最小インターフェース。テストではDIでフェイク実装に差し替える */
export interface CompressWorkerLike {
  postMessage(message: CompressWorkerRequestMessage, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<CompressWorkerMessage>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<CompressWorkerMessage>) => void,
  ): void;
  terminate(): void;
}

export interface CompressionClient {
  enqueue(
    task: CompressTask,
    callbacks?: { onStart?: () => void; onProgress?: (progress: CompressProgress) => void },
  ): Promise<CompressOutcome>;
  /**
   * 待機中(未着手)ならキューから除去、実行中ならWorkerごとterminateしてcancelledで解決する。
   * どちらでもない(既に完了済み等)場合はfalseを返す。
   */
  cancel(id: string): boolean;
  /** 全タスクを破棄しWorkerを終了する(全消去・アンマウント用) */
  cancelAll(): void;
  /** アンマウント時の後始末。cancelAllと同義 */
  destroy(): void;
}

function defaultCreateWorker(): CompressWorkerLike {
  return new Worker(new URL("./image-compress.worker.ts", import.meta.url), {
    type: "module",
  });
}

interface QueueEntry {
  task: CompressTask;
  resolve: (outcome: CompressOutcome) => void;
  onStart?: () => void;
  onProgress?: (progress: CompressProgress) => void;
}

/**
 * JPEG圧縮専用のWorkerクライアント。heic-conversion-client.tsと同じ制約を持つ。
 *
 * - Workerは常に最大1個のみ生成する
 * - Workerへ同時に送るリクエストは常に最大1件(1件が完了/失敗/キャンセルされてから次を送信する)
 * - cancel()は実行中タスクに対して即座にWorkerをterminateする(MVPではフォールバックが無いため、
 *   中断=Worker終了とし、次のenqueueで新しいWorkerを遅延生成する)
 * - cancelAll()も同様にWorkerをterminateし、以後のenqueueで新しいWorkerを遅延生成する
 * - terminate後に届き得る遅延メッセージは、Worker参照と世代番号の一致確認で無視する
 */
export function createCompressionClient(
  createWorker: () => CompressWorkerLike = defaultCreateWorker,
): CompressionClient {
  let worker: CompressWorkerLike | null = null;
  let generation = 0;
  let activeEntry: QueueEntry | null = null;
  const pendingQueue: QueueEntry[] = [];

  function ensureWorker(): { worker: CompressWorkerLike; generation: number } {
    if (!worker) {
      worker = createWorker();
      generation += 1;
    }
    return { worker, generation };
  }

  function processNext(): void {
    if (activeEntry) return; // 同時実行は常に1件まで
    const next = pendingQueue.shift();
    if (!next) return;

    activeEntry = next;
    const { worker: currentWorker, generation: currentGeneration } = ensureWorker();
    next.onStart?.();

    const onMessage = (event: MessageEvent<CompressWorkerMessage>) => {
      // Worker参照または世代が現在のものと異なる場合、古いWorkerからの遅延結果として無視する
      if (worker !== currentWorker || generation !== currentGeneration) return;
      if (!activeEntry || activeEntry.task.id !== event.data.id) return;

      const data = event.data;
      if (data.type === "progress") {
        activeEntry.onProgress?.({
          phase: data.phase,
          attempt: data.attempt,
          maxAttempts: data.maxAttempts,
        });
        return;
      }

      currentWorker.removeEventListener("message", onMessage);
      const entry = activeEntry;
      activeEntry = null;

      if (data.status === "done") {
        entry.resolve({
          status: "done",
          jpegBuffer: data.jpegBuffer,
          width: data.width,
          height: data.height,
          quality: data.quality,
          encodeCount: data.encodeCount,
          resizeCount: data.resizeCount,
          elapsedMs: data.elapsedMs,
        });
      } else if (data.status === "webp-done") {
        entry.resolve({
          status: "webp-done",
          webpBuffer: data.webpBuffer,
          width: data.width,
          height: data.height,
          quality: data.quality,
          encodeCount: data.encodeCount,
          resizeCount: data.resizeCount,
          elapsedMs: data.elapsedMs,
        });
      } else if (data.status === "unreachable") {
        entry.resolve({
          status: "unreachable",
          encodeCount: data.encodeCount,
          resizeCount: data.resizeCount,
          elapsedMs: data.elapsedMs,
        });
      } else if (data.status === "unsafe-dimensions") {
        entry.resolve({ status: "unsafe-dimensions" });
      } else if (data.status === "unsupported-webp-encoder") {
        entry.resolve({ status: "unsupported-webp-encoder" });
      } else if (data.status === "unsupported-animation") {
        entry.resolve({ status: "unsupported-animation" });
      } else if (data.status === "malformed-webp") {
        entry.resolve({ status: "malformed-webp" });
      } else if (data.status === "dimension-mismatch") {
        entry.resolve({ status: "dimension-mismatch" });
      } else {
        entry.resolve({ status: "error", message: data.message });
      }
      processNext();
    };

    currentWorker.addEventListener("message", onMessage);
    currentWorker.postMessage(
      {
        id: next.task.id,
        buffer: next.task.buffer,
        targetBytes: next.task.targetBytes,
        format: next.task.format,
      },
      [next.task.buffer],
    );
  }

  function enqueue(
    task: CompressTask,
    callbacks?: { onStart?: () => void; onProgress?: (progress: CompressProgress) => void },
  ): Promise<CompressOutcome> {
    return new Promise((resolve) => {
      pendingQueue.push({
        task,
        resolve,
        onStart: callbacks?.onStart,
        onProgress: callbacks?.onProgress,
      });
      processNext();
    });
  }

  function cancel(id: string): boolean {
    const queuedIndex = pendingQueue.findIndex((entry) => entry.task.id === id);
    if (queuedIndex !== -1) {
      const [entry] = pendingQueue.splice(queuedIndex, 1);
      entry.resolve({ status: "cancelled" });
      return true;
    }

    if (activeEntry && activeEntry.task.id === id) {
      const entry = activeEntry;
      activeEntry = null;
      entry.resolve({ status: "cancelled" });
      if (worker) {
        worker.terminate();
        worker = null;
      }
      processNext();
      return true;
    }

    return false;
  }

  function cancelAll(): void {
    const queued = pendingQueue.splice(0, pendingQueue.length);
    for (const entry of queued) {
      entry.resolve({ status: "cancelled" });
    }
    if (activeEntry) {
      const entry = activeEntry;
      activeEntry = null;
      entry.resolve({ status: "cancelled" });
    }
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function destroy(): void {
    cancelAll();
  }

  return { enqueue, cancel, cancelAll, destroy };
}
