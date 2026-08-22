import type { HeicConvertRequestMessage, HeicConvertResultMessage } from "./heic-convert.worker";

export interface HeicConvertTask {
  id: string;
  buffer: ArrayBuffer;
  quality: number;
}

export type HeicConvertOutcome =
  | { status: "done"; jpegBuffer: ArrayBuffer; jpegType: string; width: number; height: number }
  | { status: "invalid-quality" }
  | { status: "unsafe-dimensions" }
  | { status: "unsupported-jpeg-encoder" }
  | { status: "timeout" }
  | { status: "error"; message: string }
  | { status: "cancelled" };

/** Workerの最小インターフェース。テストではDIでフェイク実装に差し替える */
export interface HeicWorkerLike {
  postMessage(message: HeicConvertRequestMessage, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<HeicConvertResultMessage>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<HeicConvertResultMessage>) => void,
  ): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

export interface HeicConversionClient {
  enqueue(task: HeicConvertTask, callbacks?: { onStart?: () => void }): Promise<HeicConvertOutcome>;
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

function defaultCreateWorker(): HeicWorkerLike {
  return new Worker(new URL("./heic-convert.worker.ts", import.meta.url), {
    type: "module",
  });
}

interface QueueEntry {
  task: HeicConvertTask;
  resolve: (outcome: HeicConvertOutcome) => void;
  onStart?: () => void;
}

/**
 * Worker内タイマー(TIME_BUDGET_MS、30秒。heic-convert.worker.ts参照)が何らかの理由で
 * 応答できない場合の保険として、クライアント側でも独立したタイムアウトを持たせる。
 * 通常はWorker自身のtimeout応答が先に返るため、この値は意図的にWorker側より大きく設定している。
 */
export const CLIENT_TIMEOUT_MS = 35000;

/**
 * HEIC変換専用のWorkerクライアント。png-to-webp-client.ts / image-compression-client.ts /
 * remove-exif-client.tsと同程度に堅牢化している。
 *
 * - Workerは常に最大1個のみ生成する
 * - Workerへ同時に送るリクエストは常に最大1件(1件が完了/失敗/キャンセルされてから次を送信する)
 * - cancel()は実行中タスクに対して即座にWorkerをterminateする(中断=Worker終了とし、
 *   次のenqueueで新しいWorkerを遅延生成する)
 * - cancelAll()も同様にWorkerをterminateし、以後のenqueueで新しいWorkerを遅延生成する
 * - terminate後に届き得る遅延メッセージは、Worker参照と世代番号の一致確認で無視する
 * - timeout結果を受け取った場合も、そのWorkerを必ずterminateする。Worker内のwithTimeoutは
 *   awaitしているPromiseをrejectするだけでdecode/convertToBlobの実処理自体は止まらないため、
 *   Workerごと終了させない限り処理が裏で継続してしまう
 * - Worker内タイマーが何らかの理由で動作せず応答が一切返らないケースに備え、クライアント側にも
 *   CLIENT_TIMEOUT_MSによる独立したバックストップタイマーを持たせる
 * - Workerの"error"/"messageerror"イベント(未処理例外・構造化複製失敗等)も現在のWorkerを
 *   terminateしたうえでエラーとして解決し、次タスクは新しいWorkerで継続する
 */
export function createHeicConversionClient(
  createWorker: () => HeicWorkerLike = defaultCreateWorker,
): HeicConversionClient {
  let worker: HeicWorkerLike | null = null;
  let generation = 0;
  let activeEntry: QueueEntry | null = null;
  let activeBackstopTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingQueue: QueueEntry[] = [];

  function ensureWorker(): { worker: HeicWorkerLike; generation: number } {
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

    // createWorker()が同期的にthrowした場合(ensureWorker内)、activeEntryを残さず・
    // タイマーも作らず、現在タスクをerrorで解決してから次タスクへ進む。workerはnullのまま
    // (ensureWorkerは代入前にthrowするため、既存のnullから変化しない)。
    let currentWorker: HeicWorkerLike;
    let currentGeneration: number;
    try {
      const ensured = ensureWorker();
      currentWorker = ensured.worker;
      currentGeneration = ensured.generation;
    } catch (error) {
      activeEntry = null;
      next.resolve({
        status: "error",
        message: `HEIC変換用Workerを生成できませんでした: ${error instanceof Error ? error.message : String(error)}`,
      });
      processNext();
      return;
    }

    next.onStart?.();

    let settled = false;

    const finish = (outcome: HeicConvertOutcome, options?: { terminateWorker?: boolean }): void => {
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

    const onMessage = (event: MessageEvent<HeicConvertResultMessage>) => {
      // Worker参照または世代が現在のものと異なる場合、古いWorkerからの遅延結果として無視する
      if (isStale(event.data.id)) return;

      const data = event.data;
      if (data.status === "done") {
        finish({
          status: "done",
          jpegBuffer: data.jpegBuffer,
          jpegType: data.jpegType,
          width: data.width,
          height: data.height,
        });
      } else if (data.status === "invalid-quality") {
        finish({ status: "invalid-quality" });
      } else if (data.status === "unsafe-dimensions") {
        finish({ status: "unsafe-dimensions" });
      } else if (data.status === "unsupported-jpeg-encoder") {
        finish({ status: "unsupported-jpeg-encoder" });
      } else if (data.status === "timeout") {
        // Worker内のdecode/convertToBlobは実処理自体が止まっていない可能性があるため、
        // 次のタスクを同じWorkerで処理しないよう必ずterminateする
        finish({ status: "timeout" }, { terminateWorker: true });
      } else {
        finish({ status: "error", message: data.message });
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
    }, CLIENT_TIMEOUT_MS);

    // Worker初期設定(リスナー登録・postMessage)中の同期例外も、finish()による統一された
    // 後始末(リスナー解除・タイマー解除・terminate・worker=null・error解決・次タスク処理)で
    // 扱う。addEventListenerが一部しか完了していなくても、removeEventListenerは未登録の
    // リスナーに対して安全に呼べるため問題ない。
    try {
      currentWorker.addEventListener("message", onMessage);
      currentWorker.addEventListener("error", onError);
      currentWorker.addEventListener("messageerror", onMessageError);
      currentWorker.postMessage(
        { id: next.task.id, buffer: next.task.buffer, quality: next.task.quality },
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
    task: HeicConvertTask,
    callbacks?: { onStart?: () => void },
  ): Promise<HeicConvertOutcome> {
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
