import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { detectApng } from "./apng-detection";
import { validateDeclaredDimensions } from "./decode-safety";
import { readDeclaredDimensions } from "./image-header-dimensions";
import { createObjectUrlManager, type ObjectUrlManager } from "./object-url-manager";
import { createPngToWebpClient, type PngToWebpClient } from "./png-to-webp-client";
import { pngToWebpOutputFileName } from "./png-to-webp-output-filename";
import { qualityForPreset } from "./png-to-webp-types";
import type {
  PngToWebpEligibility,
  PngToWebpFailureReason,
  PngToWebpJob,
  PngToWebpQualityPreset,
  PngToWebpResult,
  PngToWebpSource,
} from "./png-to-webp-types";
import type { IntakeItem } from "./types";

/** PNG→WebP変換に必要なブラウザ機能(Worker/OffscreenCanvas/createImageBitmap/convertToBlob)を判定する */
function detectPngToWebpSupport(): boolean {
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

function sourceFor(item: IntakeItem): PngToWebpSource | null {
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
 * PNGのみ、APNG判定・寸法安全性検証にファイルの生バイト列読み取りが必要なため非同期になる。
 * 解決済みの結果はusePngToWebp内のstateにキャッシュし、eligibilityForへ渡す。
 */
export type PngEligibilityCheck = "ready" | "unsupported-animation" | "unsafe-dimensions";

/**
 * アイテムのPNG→WebP変換対応可否を判定する。png-to-webp-types.tsのPngToWebpEligibilityを参照。
 * PNG以外(JPEG・WebP・HEIC変換結果含む)はすべてunsupported-formatとして扱う
 * (このページはPNG以外を対象外とする)。
 * pngCheckを渡さない(省略する)場合、PNGアイテムは常にnot-ready扱いになる。
 */
export function eligibilityFor(
  item: IntakeItem,
  isSupported: boolean,
  pngCheck?: PngEligibilityCheck,
): PngToWebpEligibility {
  if (!isSupported) return { kind: "unsupported-browser" };

  const source = sourceFor(item);
  if (source) {
    if (pngCheck === undefined) return { kind: "not-ready" };
    if (pngCheck === "ready") return { kind: "ready", source };
    return { kind: pngCheck };
  }

  // allowedFormats(png、PngToWebpWorkbench.tsx参照)により、avif等の対象外形式はintake側で
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

/** HEIC変換結果等のObject URLキーと衝突しないよう、変換結果専用の接尾辞を付与する */
function pngToWebpUrlId(itemId: string): string {
  return `${itemId}-png-to-webp`;
}

export interface UsePngToWebpResult {
  isSupported: boolean;
  jobs: Record<string, PngToWebpJob>;
  eligibilityFor(item: IntakeItem): PngToWebpEligibility;
  startConversion(item: IntakeItem, preset: PngToWebpQualityPreset): void;
  cancelConversion(itemId: string): void;
  /** アイテム削除時に呼ぶ。実行中/待機中のジョブをキャンセルし、Object URLを解放する */
  removeJob(itemId: string): void;
  /** 全消去時に呼ぶ */
  clearJobs(): void;
}

/**
 * アイテムIDをキーにした独立したPngToWebpJob群を管理するフック。
 * 既存のIntakeItem/useImageIntakeの状態には一切書き込まない(状態管理を分離するため)。
 * 変換結果のObject URLは専用のObjectUrlManagerで管理し、HEIC変換結果等の既存Object URLの
 * ライフサイクルには影響しない。
 */
export function usePngToWebp(errors: Record<PngToWebpFailureReason, string>): UsePngToWebpResult {
  const [jobs, setJobs] = useState<Record<string, PngToWebpJob>>({});
  const [pngChecks, setPngChecks] = useState<Record<string, PngEligibilityCheck>>({});
  const startedChecksRef = useRef<Set<string>>(new Set());

  const isSupportedRef = useRef<boolean | undefined>(undefined);
  if (isSupportedRef.current === undefined) {
    isSupportedRef.current = detectPngToWebpSupport();
  }
  const isSupported = isSupportedRef.current;

  const clientRef = useRef<PngToWebpClient>();
  if (!clientRef.current && isSupported) {
    clientRef.current = createPngToWebpClient();
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

  const updateJob = useCallback((itemId: string, job: PngToWebpJob) => {
    setJobs((prev) => ({ ...prev, [itemId]: job }));
  }, []);

  /**
   * PNGアイテムのAPNG・寸法安全性チェックを、アイテムIDごとに一度だけ非同期実行する。
   * 呼び出しはeligibilityFor経由でレンダー中に発生しうるため、Setによる開始済み判定で
   * 重複実行(二重startやStrictModeの再実行)を防ぎ、結果はpngChecks stateへ反映して
   * 再レンダーを促す(この関数自体は同期的にstateを書き換えない)。
   */
  const ensurePngCheckStarted = useCallback((item: IntakeItem) => {
    if (item.status.kind !== "ready" || item.detectedFormat !== "png") return;
    if (startedChecksRef.current.has(item.id)) return;
    startedChecksRef.current.add(item.id);

    void (async () => {
      let result: PngEligibilityCheck;
      try {
        const buffer = await item.file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const apng = detectApng(bytes);
        if (apng === "animated") {
          result = "unsupported-animation";
        } else if (apng === "static") {
          const declaredDimensions = readDeclaredDimensions(bytes, "png");
          const safetyError = validateDeclaredDimensions(declaredDimensions);
          result = safetyError ? "unsafe-dimensions" : "ready";
        } else {
          // malformed/not-png(通常は発生しないが、壊れたPNGへの安全側フォールバック)
          result = "unsafe-dimensions";
        }
      } catch {
        result = "unsafe-dimensions";
      }
      setPngChecks((prev) => ({ ...prev, [item.id]: result }));
    })();
  }, []);

  const startConversion = useCallback(
    (item: IntakeItem, preset: PngToWebpQualityPreset) => {
      ensurePngCheckStarted(item);
      const eligibility = eligibilityFor(item, isSupported, pngChecks[item.id]);
      if (eligibility.kind !== "ready") return;
      const { source } = eligibility;

      // 同一アイテムに対する前回のジョブ(待機中/実行中)があれば、新しいジョブの前に必ず打ち切る
      clientRef.current?.cancel(item.id);

      const outputFileName = pngToWebpOutputFileName(item.file.name);
      const urlManager = urlManagerRef.current!;
      // 再変換の場合、直前の結果のObject URLを新しい結果へ置き換える前に解放する
      urlManager.revoke(pngToWebpUrlId(item.id));

      updateJob(item.id, { status: { kind: "queued" } });

      const quality = qualityForPreset(preset);

      void (async () => {
        const buffer = await source.blob.arrayBuffer();
        const client = clientRef.current;
        if (!client) return;

        const outcome = await client.enqueue(
          { id: item.id, buffer, quality },
          { onStart: () => updateJob(item.id, { status: { kind: "processing" } }) },
        );

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
        if (outcome.status === "malformed-png" || outcome.status === "dimension-mismatch") {
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
        if (outcome.status === "unsupported-webp-encoder") {
          updateJob(item.id, {
            status: {
              kind: "error",
              reason: "unsupported-webp-encoder",
              message: errors["unsupported-webp-encoder"],
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

        const outputBlob = new Blob([outcome.webpBuffer], { type: "image/webp" });
        const objectUrl = urlManagerRef.current!.create(pngToWebpUrlId(item.id), outputBlob);
        const result: PngToWebpResult = {
          objectUrl,
          blob: outputBlob,
          outputFileName,
          qualityPreset: preset,
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
    [isSupported, updateJob, pngChecks, ensurePngCheckStarted, errors],
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
    clientRef.current?.cancel(itemId);
    urlManagerRef.current?.revoke(pngToWebpUrlId(itemId));
    startedChecksRef.current.delete(itemId);
    setJobs((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    setPngChecks((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  const clearJobs = useCallback(() => {
    clientRef.current?.cancelAll();
    urlManagerRef.current?.revokeAll();
    startedChecksRef.current.clear();
    setJobs({});
    setPngChecks({});
  }, []);

  const boundEligibilityFor = useCallback(
    (item: IntakeItem) => {
      ensurePngCheckStarted(item);
      return eligibilityFor(item, isSupported, pngChecks[item.id]);
    },
    [isSupported, pngChecks, ensurePngCheckStarted],
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
