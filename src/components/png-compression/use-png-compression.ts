import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { CompressionTarget } from "../image-intake/compression-types";
import { createObjectUrlManager, type ObjectUrlManager } from "../image-intake/object-url-manager";
import type { IntakeItem } from "../image-intake/types";
import { createPngCompressionClient, detectPngCompressionSupport } from "./png-compression-client";
import type { PngCompressionClient } from "./png-compression-client";
import {
  pngCompressionMinimizedFileName,
  pngCompressionOutputFileName,
} from "./png-compression-output-filename";
import { MAX_PNG_COMPRESSION_INPUT_BYTES } from "./png-compression-types";
import type {
  PngCompressionEligibility,
  PngCompressionFailureReason,
  PngCompressionJob,
  PngCompressionSource,
} from "./png-compression-ui-types";

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
]);

function sourceFor(item: IntakeItem): PngCompressionSource | null {
  if (item.status.kind === "ready" && item.detectedFormat === "png") {
    return {
      blob: item.file,
      width: item.status.dimensions.width,
      height: item.status.dimensions.height,
    };
  }
  return null;
}

/**
 * アイテムのPNG指定容量圧縮対応可否を判定する。png-compression-ui-types.tsの
 * PngCompressionEligibilityを参照。PNG以外(JPEG・WebP・HEIC変換結果含む)はすべて
 * unsupported-formatとして扱う(このページはPNG以外を対象外とする)。
 * APNG・壊れたPNG・寸法超過等の最終判定はここでは行わず、Worker側の応答(§9)に委ねる。
 */
export function eligibilityFor(item: IntakeItem, isSupported: boolean): PngCompressionEligibility {
  if (!isSupported) return { kind: "unsupported-browser" };

  const source = sourceFor(item);
  if (source) return { kind: "ready", source };

  // allowedFormats(png、PngCompressionWorkbench.tsx参照)により、avif等の対象外形式はintake側で
  // 既に"unsupported-format"として拒否されている(item.status.kind === "ready"へは進まない)。
  // detectedFormatが実在する値(null以外)であれば案内文言を出す
  // (use-raster-to-jpg.tsのisWrongFormatRejectedと同じ設計)。isHeicPipelineは、HEICも
  // allowedFormatsで既に拒否されるため通常到達しないが、安全側として維持する。
  const isWrongFormatRejected =
    item.status.kind === "unsupported-format" && item.detectedFormat !== null;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);
  if (isWrongFormatRejected || isHeicPipeline) {
    return { kind: "unsupported-format" };
  }

  return { kind: "not-ready" };
}

function resultUrlId(itemId: string): string {
  return `${itemId}-png-compression`;
}
function bestCandidateUrlId(itemId: string): string {
  return `${itemId}-png-compression-best`;
}

/** アイテムIDごとのrequest generation(バージョン)を保持するマップを直接操作する純粋関数群。
 * コンポーネントのレンダーサイクルとは無関係な単なるカウンタなので、useCallbackのdepsに
 * 含める必要が無いようフック本体の外(モジュールスコープ)に置く。 */
function currentVersion(versions: Record<string, number>, itemId: string): number {
  return versions[itemId] ?? 0;
}
function bumpVersion(versions: Record<string, number>, itemId: string): number {
  const next = currentVersion(versions, itemId) + 1;
  versions[itemId] = next;
  return next;
}

export interface UsePngCompressionResult {
  isSupported: boolean;
  jobs: Record<string, PngCompressionJob>;
  eligibilityFor(item: IntakeItem): PngCompressionEligibility;
  startCompression(item: IntakeItem, target: CompressionTarget): void;
  cancelCompression(itemId: string): void;
  /** アイテム削除時に呼ぶ。実行中/待機中のジョブをキャンセルし、Object URLを解放する */
  removeJob(itemId: string): void;
  /** 全消去時に呼ぶ */
  clearJobs(): void;
  /**
   * 目標容量が変更された際に呼ぶ。対象アイテムの結果がdone/unreachableの場合のみ、
   * その結果を「新しい目標に対するものではない」として無効化し(needs-reprocess)、
   * 関連するObject URLを解放する。queued/processing/error/cancelled等は何もしない
   * (処理中は入力自体がdisabledのためそもそも呼ばれない)。
   */
  invalidateForTargetChange(itemId: string): void;
}

/**
 * アイテムIDをキーにした独立したPngCompressionJob群を管理するフック。
 * 既存のIntakeItem/useImageIntakeの状態には一切書き込まない(状態管理を分離するため、
 * usePngToWebp/useImageCompressionと同じ方針)。
 *
 * request generation(バージョン)によるstale結果防止: アイテムごとに単調増加する
 * バージョン番号を持ち、startCompressionのたびに新しいバージョンを発行する。
 * cancelCompression/removeJob/clearJobs/unmountはいずれも対象アイテムのバージョンを
 * 無効化(bump)する。arrayBuffer完了後・enqueue直前・onStart・outcome受信後・
 * Blob/Object URL生成前・updateJob前の各地点で「現在のバージョンと一致するか」を確認し、
 * 一致しない場合は何も表示・更新せず終了する。これにより、削除・全消去・再圧縮・
 * アンマウントがarrayBuffer読み込み中や圧縮処理中に発生しても、古い処理が後から
 * enqueueされたり、古い結果が新しい結果を上書きしたりしない。
 *
 * FIFO保証: 複数ファイルのarrayBuffer化は並行に進み得るが、Worker側へのenqueue自体は
 * enqueueOrderChainRefによるPromiseチェーンで直列化し、必ずstartCompressionが呼ばれた順に
 * enqueueする(arrayBufferの完了順には依存しない)。Worker clientのFIFO(1度に1件処理)は
 * enqueue後の順序を保証するのみで、enqueue自体の呼び出し順はこのフックの責務とする。
 *
 * 目標容量を変更した場合の再処理について: 処理中(queued/processing)はtarget入力自体を
 * disabledにする設計を踏襲するため、「処理中に目標値を変更する」という状況は構造上発生しない。
 * 一方、done/unreachableの結果が既に表示された状態で目標容量を変更した場合は
 * invalidateForTargetChangeにより明示的にneeds-reprocessへ遷移させ、古い結果を
 * 新しい目標の結果であるかのように見せ続けないようにする。
 */
export function usePngCompression(
  errors: Record<PngCompressionFailureReason, string>,
): UsePngCompressionResult {
  const [jobs, setJobs] = useState<Record<string, PngCompressionJob>>({});

  const isSupportedRef = useRef<boolean | undefined>(undefined);
  if (isSupportedRef.current === undefined) {
    isSupportedRef.current = detectPngCompressionSupport();
  }
  const isSupported = isSupportedRef.current;

  const clientRef = useRef<PngCompressionClient>();
  if (!clientRef.current && isSupported) {
    clientRef.current = createPngCompressionClient();
  }

  const urlManagerRef = useRef<ObjectUrlManager>();
  if (!urlManagerRef.current) {
    urlManagerRef.current = createObjectUrlManager();
  }

  // アイテムIDごとのrequest generation。バージョンが一致しない継続処理は全て無視する。
  const requestVersionsRef = useRef<Record<string, number>>({});

  // startCompressionが呼ばれた順にclient.enqueue()を呼ぶことを保証するためのチェーン
  const enqueueOrderChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const client = clientRef.current;
    const urlManager = urlManagerRef.current;
    return () => {
      // アンマウント後に古いarrayBuffer/enqueueの継続処理がstate更新・Object URL生成を
      // 行わないよう、既知の全アイテムのバージョンを無効化する
      for (const itemId of Object.keys(requestVersionsRef.current)) {
        bumpVersion(requestVersionsRef.current, itemId);
      }
      client?.destroy();
      urlManager?.revokeAll();
    };
  }, []);

  const updateJob = useCallback((itemId: string, job: PngCompressionJob) => {
    setJobs((prev) => ({ ...prev, [itemId]: job }));
  }, []);

  const startCompression = useCallback(
    (item: IntakeItem, target: CompressionTarget) => {
      const eligibility = eligibilityFor(item, isSupported);
      if (eligibility.kind !== "ready") return;
      const { source } = eligibility;

      // 同一アイテムに対する前回の要求(arrayBuffer読み込み中・Worker待機中・実行中)を
      // 無効化する。Worker側で実際に待機中/実行中だった場合はcancelで打ち切る。
      const version = bumpVersion(requestVersionsRef.current, item.id);
      clientRef.current?.cancel(item.id);

      const urlManager = urlManagerRef.current!;
      // 再圧縮の場合、直前の結果のObject URLを新しい結果へ置き換える前に解放する
      urlManager.revoke(resultUrlId(item.id));
      urlManager.revoke(bestCandidateUrlId(item.id));

      // arrayBuffer化・Worker送信より前に、圧縮ファイル自体のサイズ上限を確認する
      // (heic-conversion-types.tsのMAX_HEIC_INPUT_BYTESと同じ考え方の独立した安全弁)。
      // このチェックはWorker/enqueueチェーンに一切触れないため、FIFO順序へ影響しない。
      if (source.blob.size > MAX_PNG_COMPRESSION_INPUT_BYTES) {
        updateJob(item.id, {
          status: {
            kind: "error",
            reason: "too-large",
            message: errors["too-large"],
          },
        });
        return;
      }

      updateJob(item.id, { status: { kind: "queued" } });

      void (async () => {
        // 読み込み自体は即座に開始する(複数アイテムで並行に進んでよい)。
        // 失敗した場合はエラーとして扱えるよう、例外を値として持ち回る。
        const readPromise = source.blob.arrayBuffer().then(
          (buffer) => ({ ok: true as const, buffer }),
          (error: unknown) => ({ ok: false as const, error }),
        );

        // 自分の番が来るまで待つ(直前に開始された要求のenqueue呼び出しが終わるまで)。
        // ここで直列化するのはenqueue呼び出しの順序のみで、読み込み自体は並行に進む。
        const myTurn = enqueueOrderChainRef.current;
        let releaseNextTurn = () => {};
        const nextTurn = new Promise<void>((resolve) => {
          releaseNextTurn = resolve;
        });
        enqueueOrderChainRef.current = nextTurn;

        try {
          await myTurn;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return; // 順番待ち中に打ち切り・再送信で無効化された

          const readResult = await readPromise;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return; // 読み込み中に打ち切り・再送信で無効化された

          if (!readResult.ok) {
            updateJob(item.id, {
              status: { kind: "error", reason: "error", message: errors.error },
            });
            return;
          }

          const client = clientRef.current;
          if (!client) return;

          const outcomePromise = client.enqueue(
            { id: item.id, buffer: readResult.buffer, targetBytes: target.bytes },
            {
              onStart: () => {
                if (currentVersion(requestVersionsRef.current, item.id) !== version) return;
                updateJob(item.id, { status: { kind: "processing" } });
              },
            },
          );

          // enqueue呼び出しは完了した(要求順を確保できた)ので、次の要求へ順番を譲る。
          // 圧縮処理自体の完了(outcomePromiseの解決)を待つ必要は無い。
          releaseNextTurn();

          const outcome = await outcomePromise;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return; // stale outcomeは表示せず終了する

          if (outcome.status === "done") {
            const outputBlob = new Blob([outcome.pngBuffer], { type: "image/png" });
            const objectUrl = urlManagerRef.current!.create(resultUrlId(item.id), outputBlob);
            updateJob(item.id, {
              status: {
                kind: "done",
                result: {
                  objectUrl,
                  blob: outputBlob,
                  outputFileName: pngCompressionOutputFileName(item.file.name),
                  originalReturned: outcome.originalReturned,
                  originalBytes: outcome.originalBytes,
                  outputBytes: outcome.outputBytes,
                  originalWidth: outcome.originalWidth,
                  originalHeight: outcome.originalHeight,
                  outputWidth: outcome.outputWidth,
                  outputHeight: outcome.outputHeight,
                  colorCount: outcome.colorCount,
                  encodeCount: outcome.encodeCount,
                  targetBytes: target.bytes,
                },
              },
            });
            return;
          }

          if (outcome.status === "unreachable") {
            let bestCandidate;
            if (outcome.bestCandidate) {
              const bestBlob = new Blob([outcome.bestCandidate.pngBuffer], { type: "image/png" });
              const bestObjectUrl = urlManagerRef.current!.create(
                bestCandidateUrlId(item.id),
                bestBlob,
              );
              bestCandidate = {
                objectUrl: bestObjectUrl,
                blob: bestBlob,
                outputFileName: pngCompressionMinimizedFileName(item.file.name),
                outputBytes: outcome.bestCandidate.outputBytes,
                outputWidth: outcome.bestCandidate.outputWidth,
                outputHeight: outcome.bestCandidate.outputHeight,
                colorCount: outcome.bestCandidate.colorCount,
              };
            }
            updateJob(item.id, {
              status: {
                kind: "unreachable",
                result: {
                  targetBytes: target.bytes,
                  originalWidth: source.width,
                  originalHeight: source.height,
                  bestCandidate,
                },
              },
            });
            return;
          }

          if (outcome.status === "error") {
            updateJob(item.id, {
              status: { kind: "error", reason: "error", message: errors.error },
            });
            return;
          }

          if (outcome.status === "timeout") {
            updateJob(item.id, {
              status: { kind: "error", reason: "timeout", message: errors.timeout },
            });
            return;
          }

          if (outcome.status === "cancelled") {
            // cancelCompression/removeJob/clearJobs/startCompressionの再送信は全て
            // バージョンをbumpしてから打ち切るため、この分岐には実際には到達しない
            // (到達する前に必ず上のバージョン不一致チェックでreturnしている)。
            // 型を絞り込むためだけに残す安全策。
            return;
          }

          // animated-png / invalid-png / invalid-target / unsafe-dimensions / unsupported-png-encoder
          updateJob(item.id, {
            status: {
              kind: "error",
              reason: outcome.status,
              message: errors[outcome.status],
            },
          });
        } finally {
          // 早期return・例外いずれの場合でも、次の要求の順番待ちを解放する
          // (既に呼び出し済みの場合は何もしない)
          releaseNextTurn();
        }
      })();
    },
    [isSupported, updateJob, errors],
  );

  const cancelCompression = useCallback((itemId: string) => {
    // arrayBuffer読み込み中(まだWorkerへ送っていない)場合でも、Worker待機中・実行中の
    // 場合でも、どちらも安全にキャンセルできるよう先にバージョンを無効化してから
    // Worker側のcancelを試みる(該当タスクが無ければ何もしない安全なno-op)。
    bumpVersion(requestVersionsRef.current, itemId);
    clientRef.current?.cancel(itemId);
    setJobs((prev) => {
      const current = prev[itemId];
      if (!current) return prev;
      if (current.status.kind !== "queued" && current.status.kind !== "processing") return prev;
      return { ...prev, [itemId]: { status: { kind: "cancelled" } } };
    });
  }, []);

  const removeJob = useCallback((itemId: string) => {
    bumpVersion(requestVersionsRef.current, itemId);
    clientRef.current?.cancel(itemId);
    urlManagerRef.current?.revoke(resultUrlId(itemId));
    urlManagerRef.current?.revoke(bestCandidateUrlId(itemId));
    setJobs((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  const clearJobs = useCallback(() => {
    for (const itemId of Object.keys(requestVersionsRef.current)) {
      bumpVersion(requestVersionsRef.current, itemId);
    }
    clientRef.current?.cancelAll();
    urlManagerRef.current?.revokeAll();
    setJobs({});
  }, []);

  const invalidateForTargetChange = useCallback(
    (itemId: string) => {
      // jobsを直接参照する(refミラーは使わない)。CompressTargetInputのonTargetChangeは
      // 「表示されている結果がdone/unreachableである」その瞬間の描画と対になったイベントで
      // あるべきで、useEffect経由でjobsを非同期にミラーするrefだと、コミット直後の
      // イベント(プリセット再クリック等)に対して古い値を参照してしまう可能性がある。
      // jobsをそのままdepsに含めることで、常に直前のレンダーで実際に表示されていた
      // 状態と一致することを保証する。
      const current = jobs[itemId];
      if (!current) return;
      if (current.status.kind !== "done" && current.status.kind !== "unreachable") return;
      urlManagerRef.current?.revoke(resultUrlId(itemId));
      urlManagerRef.current?.revoke(bestCandidateUrlId(itemId));
      setJobs((prev) => {
        const stillCurrent = prev[itemId];
        if (!stillCurrent) return prev;
        if (stillCurrent.status.kind !== "done" && stillCurrent.status.kind !== "unreachable") {
          return prev;
        }
        return { ...prev, [itemId]: { status: { kind: "needs-reprocess" } } };
      });
    },
    [jobs],
  );

  const boundEligibilityFor = useCallback(
    (item: IntakeItem) => eligibilityFor(item, isSupported),
    [isSupported],
  );

  return {
    isSupported,
    jobs,
    eligibilityFor: boundEligibilityFor,
    startCompression,
    cancelCompression,
    removeJob,
    clearJobs,
    invalidateForTargetChange,
  };
}
