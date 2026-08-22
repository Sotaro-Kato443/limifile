import type {
  RasterConvertWorkerRequestMessage,
  RasterConvertWorkerResultMessage,
} from "./raster-convert.worker";
import type { RasterBackgroundColor, RasterSourceFormat } from "./raster-convert-types";

export interface RasterConvertTask {
  id: string;
  buffer: ArrayBuffer;
  sourceFormat: RasterSourceFormat;
  quality: number;
  background: RasterBackgroundColor;
}

export type RasterConvertOutcome =
  | {
      status: "done";
      jpegBuffer: ArrayBuffer;
      width: number;
      height: number;
      quality: number;
      elapsedMs: number;
    }
  | { status: "unsupported-animation" }
  | { status: "malformed-source" }
  | { status: "unsafe-dimensions" }
  /** AVIFのみ: 圧縮ファイル自体がMAX_AVIF_INPUT_BYTESを超える場合(raster-convert.worker.ts参照) */
  | { status: "input-too-large" }
  | { status: "dimension-mismatch" }
  | { status: "unsupported-encoder" }
  | { status: "timeout" }
  | { status: "invalid-quality" }
  | { status: "error"; message: string }
  | { status: "cancelled" };

/** Workerの最小インターフェース。テストではDIでフェイク実装に差し替える */
export interface RasterConvertWorkerLike {
  postMessage(message: RasterConvertWorkerRequestMessage, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<RasterConvertWorkerResultMessage>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<RasterConvertWorkerResultMessage>) => void,
  ): void;
  terminate(): void;
}

export interface RasterConvertClient {
  enqueue(
    task: RasterConvertTask,
    callbacks?: { onStart?: () => void },
  ): Promise<RasterConvertOutcome>;
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

function defaultCreateWorker(): RasterConvertWorkerLike {
  return new Worker(new URL("./raster-convert.worker.ts", import.meta.url), {
    type: "module",
  });
}

interface QueueEntry {
  task: RasterConvertTask;
  resolve: (outcome: RasterConvertOutcome) => void;
  onStart?: () => void;
}

/**
 * Worker内タイマー(TIME_BUDGET_MS、約20秒)が何らかの理由で応答できない場合の保険として、
 * クライアント側でも独立したタイムアウトを持たせる。通常はWorker自身のtimeout応答が
 * 先に返るため、この値は意図的にWorker側より大きく設定している。
 */
const CLIENT_TIMEOUT_MS = 25000;

/**
 * PNG/WebP→JPG変換専用のWorkerクライアント。png-to-webp-client.ts / image-compression-client.ts /
 * remove-exif-client.tsと同じ制約を持つ(このリポジトリのすべての画像処理Workerクライアントで
 * 共通の設計)。
 *
 * - Workerは常に最大1個のみ生成する
 * - Workerへ同時に送るリクエストは常に最大1件(1件が完了/失敗/キャンセルされてから次を送信する)
 * - cancel()は実行中タスクに対して即座にWorkerをterminateする(中断=Worker終了とし、
 *   次のenqueueで新しいWorkerを遅延生成する)
 * - cancelAll()も同様にWorkerをterminateし、以後のenqueueで新しいWorkerを遅延生成する
 * - terminate後に届き得る遅延メッセージは、Worker参照と世代番号の一致確認で無視する
 * - timeout結果を受け取った場合も、そのWorkerを必ずterminateする。withTimeout(Worker内)は
 *   awaitしているPromiseをrejectするだけでcreateImageBitmap/convertToBlobの実処理自体は
 *   止まらないため、Workerごと終了させない限り処理が裏で継続してしまう
 * - Worker内タイマーが何らかの理由で動作せず応答が一切返らないケースに備え、クライアント側にも
 *   CLIENT_TIMEOUT_MSによる独立したバックストップタイマーを持たせる。通常はWorker自身の
 *   timeout応答が先に返るため、バックストップが発火するのは異常時のみ
 */
export function createRasterConvertClient(
  createWorker: () => RasterConvertWorkerLike = defaultCreateWorker,
): RasterConvertClient {
  let worker: RasterConvertWorkerLike | null = null;
  let generation = 0;
  let activeEntry: QueueEntry | null = null;
  let activeBackstopTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingQueue: QueueEntry[] = [];

  function ensureWorker(): { worker: RasterConvertWorkerLike; generation: number } {
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
    const { worker: currentWorker, generation: currentGeneration } = ensureWorker();
    next.onStart?.();

    let settled = false;

    const finish = (
      outcome: RasterConvertOutcome,
      options?: { terminateWorker?: boolean },
    ): void => {
      if (settled) return;
      settled = true;
      clearActiveBackstopTimer();
      currentWorker.removeEventListener("message", onMessage);
      activeEntry = null;
      if (options?.terminateWorker) {
        currentWorker.terminate();
        if (worker === currentWorker) worker = null;
      }
      next.resolve(outcome);
      processNext();
    };

    const onMessage = (event: MessageEvent<RasterConvertWorkerResultMessage>) => {
      // Worker参照または世代が現在のものと異なる場合、古いWorkerからの遅延結果として無視する
      if (worker !== currentWorker || generation !== currentGeneration) return;
      if (!activeEntry || activeEntry.task.id !== event.data.id) return;

      const data = event.data;
      if (data.status === "done") {
        finish({
          status: "done",
          jpegBuffer: data.jpegBuffer,
          width: data.width,
          height: data.height,
          quality: data.quality,
          elapsedMs: data.elapsedMs,
        });
      } else if (data.status === "unsupported-animation") {
        finish({ status: "unsupported-animation" });
      } else if (data.status === "malformed-source") {
        finish({ status: "malformed-source" });
      } else if (data.status === "unsafe-dimensions") {
        finish({ status: "unsafe-dimensions" });
      } else if (data.status === "input-too-large") {
        finish({ status: "input-too-large" });
      } else if (data.status === "dimension-mismatch") {
        finish({ status: "dimension-mismatch" });
      } else if (data.status === "unsupported-encoder") {
        finish({ status: "unsupported-encoder" });
      } else if (data.status === "timeout") {
        // Worker内のcreateImageBitmap/convertToBlobは実処理自体が止まっていない可能性があるため、
        // 次のタスクを同じWorkerで処理しないよう必ずterminateする
        finish({ status: "timeout" }, { terminateWorker: true });
      } else if (data.status === "invalid-quality") {
        finish({ status: "invalid-quality" });
      } else {
        finish({ status: "error", message: data.message });
      }
    };

    activeBackstopTimer = setTimeout(() => {
      // Worker参照または世代が異なる場合(既にcancel等で終了済み)は何もしない
      if (worker !== currentWorker || generation !== currentGeneration) return;
      if (!activeEntry || activeEntry.task.id !== next.task.id) return;
      finish({ status: "timeout" }, { terminateWorker: true });
    }, CLIENT_TIMEOUT_MS);

    currentWorker.addEventListener("message", onMessage);
    currentWorker.postMessage(
      {
        id: next.task.id,
        buffer: next.task.buffer,
        sourceFormat: next.task.sourceFormat,
        quality: next.task.quality,
        background: next.task.background,
      },
      [next.task.buffer],
    );
  }

  function enqueue(
    task: RasterConvertTask,
    callbacks?: { onStart?: () => void },
  ): Promise<RasterConvertOutcome> {
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
