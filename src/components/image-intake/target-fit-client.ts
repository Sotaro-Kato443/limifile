import type {
  TargetFitSourceFormat,
  TargetFitWorkerRequestMessage,
  TargetFitWorkerResultMessage,
} from "./target-fit.worker";
import type { FitMode, TargetFitOutcome } from "./target-fit-types";
import type { RasterBackgroundColor } from "./raster-convert-types";

export interface TargetFitTask {
  id: string;
  buffer: ArrayBuffer;
  sourceFormat: TargetFitSourceFormat;
  targetWidth: number;
  targetHeight: number;
  maxBytes: number;
  fitMode: FitMode;
  background: RasterBackgroundColor;
}

/**
 * target-fit-client.ts自身が公開する結果。target-fit.worker.tsのTargetFitComputeOutcomeに
 * "cancelled"を加えたもの(image-compression-client.tsのCompressOutcomeと同じ設計 — Worker自身は
 * キャンセルを関知しないため、Clientの責務としてこの状態を追加する)。
 */
export type TargetFitClientOutcome = TargetFitOutcome | { status: "cancelled" };

/** Workerの最小インターフェース。テストではDIでフェイク実装に差し替える */
export interface TargetFitWorkerLike {
  postMessage(message: TargetFitWorkerRequestMessage, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<TargetFitWorkerResultMessage>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<TargetFitWorkerResultMessage>) => void,
  ): void;
  terminate(): void;
}

export interface TargetFitClient {
  enqueue(
    task: TargetFitTask,
    callbacks?: { onStart?: () => void },
  ): Promise<TargetFitClientOutcome>;
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

function defaultCreateWorker(): TargetFitWorkerLike {
  return new Worker(new URL("./target-fit.worker.ts", import.meta.url), { type: "module" });
}

interface QueueEntry {
  task: TargetFitTask;
  resolve: (outcome: TargetFitClientOutcome) => void;
  onStart?: () => void;
}

/**
 * target-fit専用のWorkerクライアント。image-compression-client.ts/heic-conversion-clientと
 * 同じ制約を持つ。
 *
 * - Workerは常に最大1個のみ生成する
 * - Workerへ同時に送るリクエストは常に最大1件(1件が完了/失敗/キャンセルされてから次を送信する)
 * - cancel()は実行中タスクに対して即座にWorkerをterminateする(MVPではフォールバックが無いため、
 *   中断=Worker終了とし、次のenqueueで新しいWorkerを遅延生成する)
 * - cancelAll()も同様にWorkerをterminateし、以後のenqueueで新しいWorkerを遅延生成する
 * - terminate後に届き得る遅延メッセージは、Worker参照と世代番号の一致確認で無視する
 */
export function createTargetFitClient(
  createWorker: () => TargetFitWorkerLike = defaultCreateWorker,
): TargetFitClient {
  let worker: TargetFitWorkerLike | null = null;
  let generation = 0;
  let activeEntry: QueueEntry | null = null;
  const pendingQueue: QueueEntry[] = [];

  function ensureWorker(): { worker: TargetFitWorkerLike; generation: number } {
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

    const onMessage = (event: MessageEvent<TargetFitWorkerResultMessage>) => {
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
          candidate: data.candidate,
          encodeCount: data.encodeCount,
          elapsedMs: data.elapsedMs,
        });
      } else if (data.status === "unreachable") {
        entry.resolve({
          status: "unreachable",
          bestCandidate: data.bestCandidate,
          encodeCount: data.encodeCount,
          elapsedMs: data.elapsedMs,
        });
      } else if (data.status === "unsupported-animation") {
        entry.resolve({ status: "unsupported-animation" });
      } else if (data.status === "unsafe-dimensions") {
        entry.resolve({ status: "unsafe-dimensions" });
      } else if (data.status === "invalid-request") {
        entry.resolve({ status: "invalid-request" });
      } else if (data.status === "unsupported-encoder") {
        entry.resolve({ status: "unsupported-encoder" });
      } else if (data.status === "timeout") {
        entry.resolve({ status: "timeout" });
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
        sourceFormat: next.task.sourceFormat,
        targetWidth: next.task.targetWidth,
        targetHeight: next.task.targetHeight,
        maxBytes: next.task.maxBytes,
        fitMode: next.task.fitMode,
        background: next.task.background,
      },
      [next.task.buffer],
    );
  }

  function enqueue(
    task: TargetFitTask,
    callbacks?: { onStart?: () => void },
  ): Promise<TargetFitClientOutcome> {
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
