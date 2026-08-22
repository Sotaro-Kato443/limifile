import type {
  PngCompressionWorkerRequestMessage,
  PngCompressionWorkerResultMessage,
} from "./png-compression.worker";
import type { PngCompressionOutcome } from "./png-compression-types";

export interface PngCompressionTask {
  id: string;
  buffer: ArrayBuffer;
  targetBytes: number;
}

/** Workerの最小インターフェース。テストではDIでフェイク実装に差し替える */
export interface PngCompressionWorkerLike {
  postMessage(message: PngCompressionWorkerRequestMessage, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PngCompressionWorkerResultMessage>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<PngCompressionWorkerResultMessage>) => void,
  ): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

export interface PngCompressionClient {
  enqueue(
    task: PngCompressionTask,
    callbacks?: { onStart?: () => void },
  ): Promise<PngCompressionOutcome>;
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

function defaultCreateWorker(): PngCompressionWorkerLike {
  return new Worker(new URL("./png-compression.worker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * PNG指定容量圧縮に必要なブラウザ機能が揃っているかを判定する。
 * 非対応の場合、Worker生成・UPNGの動的importは一切行わない(UPNGはWorker内でのみ、
 * かつこのチェックを経て初めて読み込まれる)。
 */
export function detectPngCompressionSupport(): boolean {
  if (typeof Worker === "undefined") return false;
  if (typeof createImageBitmap === "undefined") return false;
  if (typeof OffscreenCanvas === "undefined") return false;
  if (typeof OffscreenCanvas.prototype.getContext !== "function") return false;
  if (typeof OffscreenCanvas.prototype.convertToBlob !== "function") return false;
  if (typeof ImageData === "undefined") return false;
  return true;
}

interface QueueEntry {
  task: PngCompressionTask;
  resolve: (outcome: PngCompressionOutcome) => void;
  onStart?: () => void;
}

/**
 * Worker内タイマー(DEFAULT_PNG_COMPRESSION_LIMITS.workerTimeBudgetMs、15秒)が
 * 何らかの理由で応答できない場合の保険として、クライアント側でも独立したタイムアウトを持たせる。
 * 通常はWorker自身のtimeout応答が先に返るため、この値は意図的にWorker側より大きく設定している。
 */
export const CLIENT_BACKSTOP_MS = 18000;

/**
 * PNG指定容量圧縮専用のWorkerクライアント。heic-conversion-client.ts / png-to-webp-client.tsと
 * 同程度に堅牢化している。
 *
 * - 非対応ブラウザではWorkerを生成せず、即座にunsupported-browserで解決する
 * - Workerは常に最大1個のみ生成する
 * - Workerへ同時に送るリクエストは常に最大1件(FIFO、1件が完了/失敗/キャンセルされてから次を送信する)
 * - cancel()は実行中タスクに対して即座にWorkerをterminateする(中断=Worker終了とし、
 *   次のenqueueで新しいWorkerを遅延生成する)
 * - cancelAll()も同様にWorkerをterminateし、以後のenqueueで新しいWorkerを遅延生成する
 * - terminate後に届き得る遅延メッセージは、Worker参照と世代番号の一致確認で無視する(二重resolve防止)
 * - timeout結果を受け取った場合も、そのWorkerを必ずterminateする(Worker内の同期的な
 *   UPNGエンコードは一度開始すると即座には中断できないため、Workerごと終了させる)
 * - Worker内タイマーが何らかの理由で動作せず応答が一切返らないケースに備え、クライアント側にも
 *   CLIENT_BACKSTOP_MSによる独立したバックストップタイマーを持たせる
 * - Workerの"error"/"messageerror"イベント(未処理例外・構造化複製失敗等)も現在のWorkerを
 *   terminateしたうえでエラーとして解決し、次タスクは新しいWorkerで継続する
 */
export function createPngCompressionClient(
  createWorker: () => PngCompressionWorkerLike = defaultCreateWorker,
): PngCompressionClient {
  let worker: PngCompressionWorkerLike | null = null;
  let generation = 0;
  let activeEntry: QueueEntry | null = null;
  let activeBackstopTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingQueue: QueueEntry[] = [];

  function ensureWorker(): { worker: PngCompressionWorkerLike; generation: number } {
    if (!worker) {
      worker = createWorker();
      generation += 1;
    }
    return { worker, generation };
  }

  function clearActiveBackstopTimer(): void {
    if (activeBackstopTimer !== null) {
      clearTimeout(activeBackstopTimer);
      activeBackstopTimer = null;
    }
  }

  function processNext(): void {
    if (activeEntry) return; // 同時実行は常に1件まで
    const next = pendingQueue.shift();
    if (!next) return;

    activeEntry = next;

    let currentWorker: PngCompressionWorkerLike;
    let currentGeneration: number;
    try {
      const ensured = ensureWorker();
      currentWorker = ensured.worker;
      currentGeneration = ensured.generation;
    } catch (error) {
      activeEntry = null;
      next.resolve({
        status: "error",
        message: `PNG圧縮用Workerを生成できませんでした: ${error instanceof Error ? error.message : String(error)}`,
      });
      processNext();
      return;
    }

    next.onStart?.();

    let settled = false;

    const finish = (
      outcome: PngCompressionOutcome,
      options?: { terminateWorker?: boolean },
    ): void => {
      if (settled) return;
      settled = true;
      clearActiveBackstopTimer();
      currentWorker.removeEventListener("message", onMessage);
      currentWorker.removeEventListener("error", onError);
      currentWorker.removeEventListener("messageerror", onMessageError);
      activeEntry = null;
      if (options?.terminateWorker) {
        currentWorker.terminate();
        if (worker === currentWorker) worker = null;
      }
      next.resolve(outcome);
      processNext();
    };

    const isStale = (id: string): boolean => {
      if (worker !== currentWorker || generation !== currentGeneration) return true;
      return !activeEntry || activeEntry.task.id !== id;
    };

    const onMessage = (event: MessageEvent<PngCompressionWorkerResultMessage>) => {
      if (isStale(event.data.id)) return;
      const { outcome } = event.data;
      if (outcome.status === "timeout") {
        // Worker内のUPNGエンコードは実処理自体が止まっていない可能性があるため、
        // 次のタスクを同じWorkerで処理しないよう必ずterminateする
        finish(outcome, { terminateWorker: true });
      } else {
        finish(outcome);
      }
    };

    const onError = (event: ErrorEvent) => {
      // Workerのエラーをタスク結果として処理するだけでなく、ブラウザの未処理エラーとして
      // Consoleへ残さないよう最初に抑止する。staleな旧Workerからのイベントであっても、
      // isStale判定より前に必ず呼ぶ。
      event.preventDefault();
      if (isStale(next.task.id)) return;
      finish(
        { status: "error", message: event.message || "Workerで予期しないエラーが発生しました" },
        { terminateWorker: true },
      );
    };

    const onMessageError = () => {
      if (isStale(next.task.id)) return;
      finish(
        { status: "error", message: "Workerからのメッセージを復元できませんでした" },
        { terminateWorker: true },
      );
    };

    activeBackstopTimer = setTimeout(() => {
      if (isStale(next.task.id)) return;
      finish({ status: "timeout" }, { terminateWorker: true });
    }, CLIENT_BACKSTOP_MS);

    // Worker初期設定(リスナー登録・postMessage)中の同期例外も、finish()による統一された
    // 後始末(リスナー解除・タイマー解除・terminate・worker=null・error解決・次タスク処理)で
    // 扱う。addEventListenerが一部しか完了していなくても、removeEventListenerは未登録の
    // リスナーに対して安全に呼べるため問題ない。
    try {
      currentWorker.addEventListener("message", onMessage);
      currentWorker.addEventListener("error", onError);
      currentWorker.addEventListener("messageerror", onMessageError);
      currentWorker.postMessage(
        { id: next.task.id, buffer: next.task.buffer, targetBytes: next.task.targetBytes },
        [next.task.buffer],
      );
    } catch (error) {
      finish(
        {
          status: "error",
          message: `Workerへの送信に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        },
        { terminateWorker: true },
      );
    }
  }

  function enqueue(
    task: PngCompressionTask,
    callbacks?: { onStart?: () => void },
  ): Promise<PngCompressionOutcome> {
    if (!detectPngCompressionSupport()) {
      return Promise.resolve({ status: "unsupported-browser" });
    }
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
      clearActiveBackstopTimer();
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
      clearActiveBackstopTimer();
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
