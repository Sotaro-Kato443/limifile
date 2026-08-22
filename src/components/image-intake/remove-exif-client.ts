import type {
  RemoveExifWorkerRequestMessage,
  RemoveExifWorkerResultMessage,
} from "./remove-exif.worker";
import type { RemoveExifErrorCode } from "./jpeg-metadata";

export interface RemoveExifTask {
  id: string;
  buffer: ArrayBuffer;
}

export type RemoveExifOutcome =
  | {
      status: "done";
      jpegBuffer: ArrayBuffer;
      originalBytes: number;
      outputBytes: number;
      orientationKept: boolean;
      iccKept: boolean;
      elapsedMs: number;
    }
  | { status: "error"; code: RemoveExifErrorCode; message: string }
  | { status: "cancelled" };

/** Workerの最小インターフェース。テストではDIでフェイク実装に差し替える */
export interface RemoveExifWorkerLike {
  postMessage(message: RemoveExifWorkerRequestMessage, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<RemoveExifWorkerResultMessage>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<RemoveExifWorkerResultMessage>) => void,
  ): void;
  terminate(): void;
}

export interface RemoveExifClient {
  enqueue(task: RemoveExifTask, callbacks?: { onStart?: () => void }): Promise<RemoveExifOutcome>;
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

function defaultCreateWorker(): RemoveExifWorkerLike {
  return new Worker(new URL("./remove-exif.worker.ts", import.meta.url), {
    type: "module",
  });
}

interface QueueEntry {
  task: RemoveExifTask;
  resolve: (outcome: RemoveExifOutcome) => void;
  onStart?: () => void;
}

/**
 * メタデータ削除専用のWorkerクライアント。image-compression-client.ts / heic-conversion-client.tsと
 * 同じ制約を持つ。
 *
 * - Workerは常に最大1個のみ生成する
 * - Workerへ同時に送るリクエストは常に最大1件(1件が完了/失敗/キャンセルされてから次を送信する)
 * - cancel()は実行中タスクに対して即座にWorkerをterminateする(中断=Worker終了とし、
 *   次のenqueueで新しいWorkerを遅延生成する)
 * - cancelAll()も同様にWorkerをterminateし、以後のenqueueで新しいWorkerを遅延生成する
 * - terminate後に届き得る遅延メッセージは、Worker参照と世代番号の一致確認で無視する
 */
export function createRemoveExifClient(
  createWorker: () => RemoveExifWorkerLike = defaultCreateWorker,
): RemoveExifClient {
  let worker: RemoveExifWorkerLike | null = null;
  let generation = 0;
  let activeEntry: QueueEntry | null = null;
  const pendingQueue: QueueEntry[] = [];

  function ensureWorker(): { worker: RemoveExifWorkerLike; generation: number } {
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

    const onMessage = (event: MessageEvent<RemoveExifWorkerResultMessage>) => {
      // Worker参照または世代が現在のものと異なる場合、古いWorkerからの遅延結果として無視する
      if (worker !== currentWorker || generation !== currentGeneration) return;
      if (!activeEntry || activeEntry.task.id !== event.data.id) return;

      currentWorker.removeEventListener("message", onMessage);
      const entry = activeEntry;
      activeEntry = null;

      const data = event.data;
      if (data.status === "done") {
        entry.resolve({
          status: "done",
          jpegBuffer: data.jpegBuffer,
          originalBytes: data.originalBytes,
          outputBytes: data.outputBytes,
          orientationKept: data.orientationKept,
          iccKept: data.iccKept,
          elapsedMs: data.elapsedMs,
        });
      } else {
        entry.resolve({ status: "error", code: data.code, message: data.message });
      }
      processNext();
    };

    currentWorker.addEventListener("message", onMessage);
    currentWorker.postMessage({ id: next.task.id, buffer: next.task.buffer }, [next.task.buffer]);
  }

  function enqueue(
    task: RemoveExifTask,
    callbacks?: { onStart?: () => void },
  ): Promise<RemoveExifOutcome> {
    return new Promise((resolve) => {
      pendingQueue.push({ task, resolve, onStart: callbacks?.onStart });
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
