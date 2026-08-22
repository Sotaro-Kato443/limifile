import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { detectApng } from "./apng-detection";
import { validateDeclaredDimensions } from "./decode-safety";
import { readDeclaredDimensions } from "./image-header-dimensions";
import { createObjectUrlManager, type ObjectUrlManager } from "./object-url-manager";
import { createRasterConvertClient, type RasterConvertClient } from "./raster-convert-client";
import { rasterToJpgOutputFileName } from "./raster-convert-output-filename";
import { qualityForRasterPreset } from "./raster-convert-types";
import { detectWebpAnimation } from "./webp-animation-detection";
import type {
  RasterBackgroundColor,
  RasterQualityPreset,
  RasterSourceFormat,
  RasterToJpgEligibility,
  RasterToJpgFailureReason,
  RasterToJpgJob,
  RasterToJpgResult,
  RasterToJpgSource,
} from "./raster-convert-types";
import type { IntakeItem } from "./types";

/** PNG/WebP→JPG変換に必要なブラウザ機能(Worker/OffscreenCanvas/createImageBitmap/convertToBlob)を判定する */
function detectRasterToJpgSupport(): boolean {
  if (typeof Worker === "undefined") return false;
  if (typeof OffscreenCanvas === "undefined") return false;
  if (typeof createImageBitmap === "undefined") return false;
  if (typeof OffscreenCanvas.prototype.convertToBlob !== "function") return false;
  return true;
}

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
]);

function sourceFor(item: IntakeItem, sourceFormat: RasterSourceFormat): RasterToJpgSource | null {
  if (item.status.kind === "ready" && item.detectedFormat === sourceFormat) {
    return {
      blob: item.file,
      width: item.status.dimensions.width,
      height: item.status.dimensions.height,
    };
  }
  return null;
}

/**
 * アニメーション判定・寸法安全性検証にファイルの生バイト列読み取りが必要なため非同期になる。
 * 解決済みの結果はuseRasterToJpg内のstateにキャッシュし、eligibilityForへ渡す。
 */
export type RasterAnimationCheck = "ready" | "unsupported-animation" | "unsafe-dimensions";

/**
 * アイテムのPNG/WebP/AVIF→JPG変換対応可否を判定する。raster-convert-types.tsのRasterToJpgEligibilityを参照。
 * sourceFormat以外(PNG→JPGページでのWebP・WebP→JPGページでのPNG、およびJPEG・HEIC変換結果含む)は
 * すべてunsupported-formatとして扱う(1ページにつき1つのsourceFormatのみを対象とする)。
 * animationCheckを渡さない(省略する)場合、sourceFormatに一致するアイテムは常にnot-ready扱いになる。
 *
 * AVIFはこの関数自体が純粋関数のまま完結する: sourceFormat==="avif"の場合、animationCheckを
 * 一切参照せずsourceが揃った時点で直ちにreadyを返す。use-image-intake.tsのavifPreflightが、
 * "ready"へ進む前に既にavis判定・ispe候補の個別検証を完了させているため、ここで再チェックする
 * 意味が無いことに加え、animationChecks stateへ書き込む経路(ensureAnimationCheckStarted)自体を
 * 完全に無くすことで、eligibilityForがrenderフェーズから呼ばれてもsetStateを一切引き起こさない
 * (PNG/WebPと違い、AVIFはstateに依存しない)。
 */
export function eligibilityFor(
  item: IntakeItem,
  sourceFormat: RasterSourceFormat,
  isSupported: boolean,
  animationCheck?: RasterAnimationCheck,
): RasterToJpgEligibility {
  if (!isSupported) return { kind: "unsupported-browser" };

  const source = sourceFor(item, sourceFormat);
  if (source) {
    if (sourceFormat === "avif") return { kind: "ready", source };
    if (animationCheck === undefined) return { kind: "not-ready" };
    if (animationCheck === "ready") return { kind: "ready", source };
    return { kind: animationCheck };
  }

  const isWrongFormatReady = item.status.kind === "ready" && item.detectedFormat !== sourceFormat;
  // useImageIntakeのallowedFormats(このコンポーネントではsourceFormatのみを許可する)により、
  // sourceFormat以外の実在する形式(HEIC・JPEG・逆側のPNG/WebP等)は、readyへ進む前に
  // status.kind="unsupported-format"として弾かれる。detectedFormatが実在する値(nullでない)の
  // 場合はこのページ向けの具体的な文言(formatMismatch)を出すべきなので、ここでも
  // unsupported-formatとして扱う。detectedFormatがnull(そもそも画像として認識できない)の
  // 場合は汎用文言(messages.intakeErrors.unsupportedFormat)に委ね、not-readyのまま返す。
  const isWrongFormatRejected =
    item.status.kind === "unsupported-format" &&
    item.detectedFormat !== null &&
    item.detectedFormat !== sourceFormat;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);
  if (isWrongFormatReady || isWrongFormatRejected || isHeicPipeline) {
    return { kind: "unsupported-format" };
  }

  return { kind: "not-ready" };
}

/** HEIC変換結果等のObject URLキーと衝突しないよう、変換結果専用の接尾辞を付与する */
function rasterToJpgUrlId(itemId: string): string {
  return `${itemId}-raster-to-jpg`;
}

export interface UseRasterToJpgResult {
  isSupported: boolean;
  jobs: Record<string, RasterToJpgJob>;
  eligibilityFor(item: IntakeItem): RasterToJpgEligibility;
  startConversion(
    item: IntakeItem,
    preset: RasterQualityPreset,
    background: RasterBackgroundColor,
  ): void;
  cancelConversion(itemId: string): void;
  /** アイテム削除時に呼ぶ。実行中/待機中のジョブをキャンセルし、Object URLを解放する */
  removeJob(itemId: string): void;
  /** 全消去時に呼ぶ */
  clearJobs(): void;
}

/**
 * アイテムIDをキーにした独立したRasterToJpgJob群を管理するフック。use-png-to-webp.tsと同じ設計だが、
 * sourceFormat("png"|"webp")をパラメータ化することでPNG→JPG・WebP→JPGの両ページから共有する。
 * 既存のIntakeItem/useImageIntakeの状態には一切書き込まない(状態管理を分離するため)。
 * 変換結果のObject URLは専用のObjectUrlManagerで管理し、HEIC変換結果等の既存Object URLの
 * ライフサイクルには影響しない。
 */
export function useRasterToJpg(
  sourceFormat: RasterSourceFormat,
  errors: Record<RasterToJpgFailureReason, string>,
): UseRasterToJpgResult {
  const [jobs, setJobs] = useState<Record<string, RasterToJpgJob>>({});
  const [animationChecks, setAnimationChecks] = useState<Record<string, RasterAnimationCheck>>({});
  const startedChecksRef = useRef<Set<string>>(new Set());
  /**
   * アイテムIDごとの世代番号。startConversionは`await source.blob.arrayBuffer()`と
   * `await client.enqueue(...)`という2つのキャンセル不能な非同期境界をまたぐため、
   * その間にremoveJob/clearJobs/同一アイテムへの再変換が発生すると、古い非同期処理が
   * 後から解決してjob/Object URLを復活させたり、新しい変換を上書きしたりし得る。
   * startConversion開始時にそのアイテムの世代をインクリメントして記録し、各await直後に
   * 「呼び出し時点の世代がまだ現在の世代と一致するか」を確認することで、stale化した
   * 処理はclient.enqueue自体を呼ばず、結果も一切state/Object URLへ反映しないようにする。
   * removeJob/clearJobsも該当アイテムの世代をインクリメントし、進行中の処理を確実にstale化する。
   */
  const generationRef = useRef<Record<string, number>>({});

  const isSupportedRef = useRef<boolean | undefined>(undefined);
  if (isSupportedRef.current === undefined) {
    isSupportedRef.current = detectRasterToJpgSupport();
  }
  const isSupported = isSupportedRef.current;

  const clientRef = useRef<RasterConvertClient>();
  if (!clientRef.current && isSupported) {
    clientRef.current = createRasterConvertClient();
  }

  const urlManagerRef = useRef<ObjectUrlManager>();
  if (!urlManagerRef.current) {
    urlManagerRef.current = createObjectUrlManager();
  }

  useEffect(() => {
    const client = clientRef.current;
    const urlManager = urlManagerRef.current;
    return () => {
      client?.destroy();
      urlManager?.revokeAll();
    };
  }, []);

  const updateJob = useCallback((itemId: string, job: RasterToJpgJob) => {
    setJobs((prev) => ({ ...prev, [itemId]: job }));
  }, []);

  /**
   * sourceFormatアイテムのアニメーション・寸法安全性チェックを、アイテムIDごとに一度だけ非同期実行する。
   * 呼び出しはeligibilityFor経由でレンダー中に発生しうるため、Setによる開始済み判定で
   * 重複実行(二重startやStrictModeの再実行)を防ぎ、結果はanimationChecks stateへ反映して
   * 再レンダーを促す(この関数自体は同期的にstateを書き換えない)。
   *
   * AVIFはこの関数自体が何もしない(state更新も含めて)。use-image-intake.tsのanalyze()が、
   * AVIFアイテムを"ready"にする前に既にavis判定・ispe候補の個別検証を完了させているため
   * (avifPreflight参照)、この時点で既に安全と分かっている。png/webpと同じ内容を
   * file.arrayBuffer()でもう一度読み直すのは無駄な二重処理になるだけでなく、eligibilityForが
   * この関数の呼び出しをrenderフェーズで行うため、ここでsetStateすると
   * render中の同期state更新になってしまう。そのためAVIFの判定はanimationChecks stateに
   * 一切依存させず、eligibilityFor自身が純粋関数のままsourceFormat==="avif"を見て
   * 直接readyを返す(このファイル内のeligibilityFor定義を参照)。
   */
  const ensureAnimationCheckStarted = useCallback(
    (item: IntakeItem) => {
      if (item.status.kind !== "ready" || item.detectedFormat !== sourceFormat) return;
      // AVIFはeligibilityFor自体が純粋関数のままreadyを判定できるため、animationChecks state
      // への書き込みが一切不要(このstateはPNG/WebPの非同期チェック結果をキャッシュするためだけの
      // ものであり、AVIFはこの関数を呼び出したままでも何もしない)。stateを変更しないため
      // startedChecksRef(重複実行防止)へも追加せず、以後この関数が呼ばれ続けても無害。
      if (sourceFormat === "avif") return;

      if (startedChecksRef.current.has(item.id)) return;
      startedChecksRef.current.add(item.id);

      void (async () => {
        let result: RasterAnimationCheck;
        try {
          const buffer = await item.file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const animationCheck =
            sourceFormat === "png" ? detectApng(bytes) : detectWebpAnimation(bytes);
          if (animationCheck === "animated") {
            result = "unsupported-animation";
          } else if (animationCheck === "static") {
            const declaredDimensions = readDeclaredDimensions(bytes, sourceFormat);
            const safetyError = validateDeclaredDimensions(declaredDimensions);
            result = safetyError ? "unsafe-dimensions" : "ready";
          } else {
            // malformed/not-png/not-webp(通常は発生しないが、壊れた入力への安全側フォールバック)
            result = "unsafe-dimensions";
          }
        } catch {
          result = "unsafe-dimensions";
        }
        setAnimationChecks((prev) => ({ ...prev, [item.id]: result }));
      })();
    },
    [sourceFormat],
  );

  const startConversion = useCallback(
    (item: IntakeItem, preset: RasterQualityPreset, background: RasterBackgroundColor) => {
      ensureAnimationCheckStarted(item);
      const eligibility = eligibilityFor(item, sourceFormat, isSupported, animationChecks[item.id]);
      if (eligibility.kind !== "ready") return;
      const { source } = eligibility;

      // 同一アイテムに対する前回のジョブ(待機中/実行中)があれば、新しいジョブの前に必ず打ち切る
      clientRef.current?.cancel(item.id);

      const outputFileName = rasterToJpgOutputFileName(item.file.name);
      const urlManager = urlManagerRef.current!;
      // 再変換の場合、直前の結果のObject URLを新しい結果へ置き換える前に解放する
      urlManager.revoke(rasterToJpgUrlId(item.id));

      updateJob(item.id, { status: { kind: "queued" } });

      const quality = qualityForRasterPreset(preset);

      const generation = (generationRef.current[item.id] ?? 0) + 1;
      generationRef.current[item.id] = generation;
      const isStale = () => generationRef.current[item.id] !== generation;

      void (async () => {
        const buffer = await source.blob.arrayBuffer();
        // removeJob/clearJobs、または同一アイテムへの再変換がこの待機中に発生していた場合、
        // 世代が既に進んでいるため、client.enqueueを呼ばずここで打ち切る
        // (待機中item.idを二重enqueueしない/削除済みitemを復活させない)。
        if (isStale()) return;
        const client = clientRef.current;
        if (!client) return;

        const outcome = await client.enqueue(
          { id: item.id, buffer, sourceFormat, quality, background },
          {
            onStart: () => {
              if (!isStale()) updateJob(item.id, { status: { kind: "processing" } });
            },
          },
        );

        // enqueue完了を待つ間にも同じ理由でstale化し得るため、結果を反映する前に再確認する
        // (古いconversionが新しいreconversionのjob/Object URLを上書きしない)。
        if (isStale()) return;

        if (outcome.status === "cancelled") {
          // cancelConversion/removeJob側で既にcancelled状態へ更新済みのため何もしない
          return;
        }
        if (outcome.status === "unsupported-animation") {
          updateJob(item.id, {
            status: {
              kind: "error",
              reason: "unsupported-animation",
              message: errors["unsupported-animation"],
            },
          });
          return;
        }
        if (outcome.status === "malformed-source" || outcome.status === "dimension-mismatch") {
          updateJob(item.id, {
            status: { kind: "error", reason: "decode-failed", message: errors["decode-failed"] },
          });
          return;
        }
        if (outcome.status === "unsafe-dimensions") {
          updateJob(item.id, {
            status: {
              kind: "error",
              reason: "unsafe-dimensions",
              message: errors["unsafe-dimensions"],
            },
          });
          return;
        }
        if (outcome.status === "input-too-large") {
          // AVIFのみ到達しうる、Worker側の最終防御(raster-convert.worker.ts参照)。
          // intake側(use-image-intake.ts)が既にfile.size上限を検証しているため、通常のUIからは
          // 到達しない想定だが、型として表現されている以上ハンドリングを省略しない。
          updateJob(item.id, {
            status: {
              kind: "error",
              reason: "input-too-large",
              message: errors["input-too-large"],
            },
          });
          return;
        }
        if (outcome.status === "unsupported-encoder") {
          updateJob(item.id, {
            status: {
              kind: "error",
              reason: "unsupported-encoder",
              message: errors["unsupported-encoder"],
            },
          });
          return;
        }
        if (outcome.status === "timeout") {
          updateJob(item.id, {
            status: { kind: "error", reason: "timeout", message: errors.timeout },
          });
          return;
        }
        if (outcome.status === "invalid-quality" || outcome.status === "error") {
          updateJob(item.id, {
            status: { kind: "error", reason: "encode-failed", message: errors["encode-failed"] },
          });
          return;
        }

        const outputBlob = new Blob([outcome.jpegBuffer], { type: "image/jpeg" });
        const objectUrl = urlManagerRef.current!.create(rasterToJpgUrlId(item.id), outputBlob);
        const result: RasterToJpgResult = {
          objectUrl,
          blob: outputBlob,
          outputFileName,
          qualityPreset: preset,
          background,
          originalBytes: source.blob.size,
          outputBytes: outputBlob.size,
          originalWidth: source.width,
          originalHeight: source.height,
          outputWidth: outcome.width,
          outputHeight: outcome.height,
          elapsedMs: outcome.elapsedMs,
        };
        updateJob(item.id, { status: { kind: "done", result } });
      })();
    },
    [sourceFormat, isSupported, updateJob, animationChecks, ensureAnimationCheckStarted, errors],
  );

  const cancelConversion = useCallback((itemId: string) => {
    const cancelled = clientRef.current?.cancel(itemId) ?? false;
    if (!cancelled) return;
    setJobs((prev) => {
      if (!(itemId in prev)) return prev;
      return { ...prev, [itemId]: { status: { kind: "cancelled" } } };
    });
  }, []);

  const removeJob = useCallback((itemId: string) => {
    // 進行中(arrayBuffer待ち/enqueue待ち)のstartConversionを確実にstale化する
    generationRef.current[itemId] = (generationRef.current[itemId] ?? 0) + 1;
    clientRef.current?.cancel(itemId);
    urlManagerRef.current?.revoke(rasterToJpgUrlId(itemId));
    startedChecksRef.current.delete(itemId);
    setJobs((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    setAnimationChecks((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  const clearJobs = useCallback(() => {
    // 進行中の全startConversionを確実にstale化する
    for (const itemId of Object.keys(generationRef.current)) {
      generationRef.current[itemId] += 1;
    }
    clientRef.current?.cancelAll();
    urlManagerRef.current?.revokeAll();
    startedChecksRef.current.clear();
    setJobs({});
    setAnimationChecks({});
  }, []);

  const boundEligibilityFor = useCallback(
    (item: IntakeItem) => {
      ensureAnimationCheckStarted(item);
      return eligibilityFor(item, sourceFormat, isSupported, animationChecks[item.id]);
    },
    [sourceFormat, isSupported, animationChecks, ensureAnimationCheckStarted],
  );

  return {
    isSupported,
    jobs,
    eligibilityFor: boundEligibilityFor,
    startConversion,
    cancelConversion,
    removeJob,
    clearJobs,
  };
}
