import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createObjectUrlManager, type ObjectUrlManager } from "./object-url-manager";
import { buildConditionChecklist } from "./target-fit-condition-check";
import { createTargetFitClient, type TargetFitClient } from "./target-fit-client";
import { targetFitOutputFileName } from "./target-fit-output-filename";
import type {
  TargetFitCandidate,
  TargetFitEligibility,
  TargetFitFailureReason,
  TargetFitJob,
  TargetFitRequest,
  TargetFitResult,
  TargetFitSource,
  TargetFitSourceFormat,
} from "./target-fit-types";
import type { IntakeItem } from "./types";

/**
 * target-fit(target-fit-*.ts)に必要なブラウザ機能(Worker/OffscreenCanvas/createImageBitmap/
 * convertToBlob)を同期的に判定する。use-image-compression.tsのdetectCompressionSupportと同じ設計。
 */
function detectTargetFitSupport(): boolean {
  if (typeof Worker === "undefined") return false;
  if (typeof OffscreenCanvas === "undefined") return false;
  if (typeof createImageBitmap === "undefined") return false;
  if (typeof OffscreenCanvas.prototype.convertToBlob !== "function") return false;
  return true;
}

function sourceFor(
  item: IntakeItem,
  allowedSourceFormats: readonly TargetFitSourceFormat[],
): TargetFitSource | null {
  if (item.status.kind !== "ready") return null;
  const format = item.detectedFormat;
  if (format !== "jpeg" && format !== "png") return null;
  if (!allowedSourceFormats.includes(format)) return null;
  return {
    blob: item.file,
    width: item.status.dimensions.width,
    height: item.status.dimensions.height,
    format,
  };
}

/**
 * アイテムのtarget-fit対応可否を判定する。target-fit-types.tsのTargetFitEligibilityを参照。
 * "signature"等の用途固有概念を持たない(allowedSourceFormatsは呼び出し側Workbenchが指定する)。
 */
export function eligibilityFor(
  item: IntakeItem,
  isSupported: boolean,
  allowedSourceFormats: readonly TargetFitSourceFormat[],
): TargetFitEligibility {
  if (!isSupported) return { kind: "unsupported-browser" };

  const source = sourceFor(item, allowedSourceFormats);
  if (source) return { kind: "ready", source };

  // allowedFormats(呼び出し側Workbenchのuse-image-intake({allowedFormats})参照)により、
  // 対象外形式はintake側で既に"unsupported-format"として拒否されている
  // (item.status.kind === "ready"へは進まない)。detectedFormatが実在する値(null以外)であれば
  // このツール固有の案内文言を出す(use-raster-to-jpg.tsのisWrongFormatRejectedと同じ設計)。
  const isWrongFormatRejected =
    item.status.kind === "unsupported-format" && item.detectedFormat !== null;
  if (isWrongFormatRejected) {
    return { kind: "unsupported-format" };
  }

  return { kind: "not-ready" };
}

function targetFitUrlId(itemId: string): string {
  return `${itemId}-target-fit`;
}
function targetFitBestCandidateUrlId(itemId: string): string {
  return `${itemId}-target-fit-best`;
}

/** アイテムIDごとのrequest generation(バージョン)を保持するマップを直接操作する純粋関数群。
 * use-image-compression.tsと同じ方式(コンポーネントのレンダーサイクルとは無関係な単なるカウンタ)。 */
function currentVersion(versions: Record<string, number>, itemId: string): number {
  return versions[itemId] ?? 0;
}
function bumpVersion(versions: Record<string, number>, itemId: string): number {
  const next = currentVersion(versions, itemId) + 1;
  versions[itemId] = next;
  return next;
}

function buildResult(
  candidate: TargetFitCandidate,
  request: TargetFitRequest,
  source: TargetFitSource,
  outputFileName: string,
  objectUrl: string,
  encodeCount: number,
  elapsedMs: number,
): TargetFitResult {
  // Worker側(target-fit.worker.ts)がblob.typeとして実測確認した値をそのまま使う。
  // ここで"image/jpeg"を決め打ちすると、Workerが実際に検証した結果を無視して
  // 未検証のバイト列へ後からラベルを貼り直すことになってしまう(レビューで指摘)。
  const jpegBlob = new Blob([candidate.jpegBuffer], { type: candidate.mimeType });
  return {
    objectUrl,
    blob: jpegBlob,
    outputFileName,
    request,
    checklist: buildConditionChecklist(candidate, request),
    originalBytes: source.blob.size,
    originalWidth: source.width,
    originalHeight: source.height,
    outputWidth: candidate.width,
    outputHeight: candidate.height,
    outputBytes: candidate.bytes,
    quality: candidate.quality,
    upscaled: candidate.upscaled,
    encodeCount,
    elapsedMs,
  };
}

export interface UseTargetFitResult {
  isSupported: boolean;
  jobs: Record<string, TargetFitJob>;
  eligibilityFor(item: IntakeItem): TargetFitEligibility;
  startTargetFit(item: IntakeItem, request: TargetFitRequest): void;
  cancelTargetFit(itemId: string): void;
  /** アイテム削除時に呼ぶ。実行中/待機中のジョブをキャンセルし、Object URLを解放する */
  removeJob(itemId: string): void;
  /** 全消去時に呼ぶ */
  clearJobs(): void;
}

/**
 * アイテムIDをキーにした独立したTargetFitJob群を管理するフック。use-image-compression.tsと
 * 同じ設計(既存のIntakeItem/useImageIntakeの状態には一切書き込まない)。
 *
 * allowedSourceFormatsをパラメータとして受け取り、hook自体はjpeg/pngをハードコードしない
 * (署名以外のWorkbenchからも同じhookを再利用できるようにするため)。
 *
 * request generation(バージョン)によるstale結果防止・enqueue順序のFIFO保証は
 * use-image-compression.tsと全く同じ方式を踏襲する。WebPの ensureWebpCheckStarted のような
 * 非同期事前チェックは持たない(target-fitの入力(JPEG/PNG)はいずれもitem.status.kind==="ready"に
 * 到達した時点で寸法が同期的に既知であり、animation検知はWorker側の応答に委ねる設計のため
 * — use-png-compression.tsの前例と同じ)。
 */
export function useTargetFit(
  errors: Record<TargetFitFailureReason, string>,
  allowedSourceFormats: readonly TargetFitSourceFormat[],
): UseTargetFitResult {
  const [jobs, setJobs] = useState<Record<string, TargetFitJob>>({});

  const isSupportedRef = useRef<boolean | undefined>(undefined);
  if (isSupportedRef.current === undefined) {
    isSupportedRef.current = detectTargetFitSupport();
  }
  const isSupported = isSupportedRef.current;

  const clientRef = useRef<TargetFitClient>();
  if (!clientRef.current && isSupported) {
    clientRef.current = createTargetFitClient();
  }

  const urlManagerRef = useRef<ObjectUrlManager>();
  if (!urlManagerRef.current) {
    urlManagerRef.current = createObjectUrlManager();
  }

  const requestVersionsRef = useRef<Record<string, number>>({});
  const enqueueOrderChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const client = clientRef.current;
    const urlManager = urlManagerRef.current;
    return () => {
      for (const itemId of Object.keys(requestVersionsRef.current)) {
        bumpVersion(requestVersionsRef.current, itemId);
      }
      client?.destroy();
      urlManager?.revokeAll();
    };
  }, []);

  const updateJob = useCallback((itemId: string, job: TargetFitJob) => {
    setJobs((prev) => ({ ...prev, [itemId]: job }));
  }, []);

  const startTargetFit = useCallback(
    (item: IntakeItem, request: TargetFitRequest) => {
      const eligibility = eligibilityFor(item, isSupported, allowedSourceFormats);
      if (eligibility.kind !== "ready") return;
      const { source } = eligibility;

      const version = bumpVersion(requestVersionsRef.current, item.id);
      clientRef.current?.cancel(item.id);

      const outputFileName = targetFitOutputFileName(item.file.name);
      const urlManager = urlManagerRef.current!;
      urlManager.revoke(targetFitUrlId(item.id));
      urlManager.revoke(targetFitBestCandidateUrlId(item.id));

      updateJob(item.id, { request, status: { kind: "queued" } });

      void (async () => {
        const readPromise = source.blob.arrayBuffer().then(
          (buffer) => ({ ok: true as const, buffer }),
          (error: unknown) => ({ ok: false as const, error }),
        );

        const myTurn = enqueueOrderChainRef.current;
        let releaseNextTurn = () => {};
        const nextTurn = new Promise<void>((resolve) => {
          releaseNextTurn = resolve;
        });
        enqueueOrderChainRef.current = nextTurn;

        try {
          await myTurn;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return;

          const readResult = await readPromise;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return;

          if (!readResult.ok) {
            updateJob(item.id, {
              request,
              status: { kind: "error", reason: "encode-failed", message: errors["encode-failed"] },
            });
            return;
          }

          const client = clientRef.current;
          if (!client) return;

          const outcomePromise = client.enqueue(
            {
              id: item.id,
              buffer: readResult.buffer,
              sourceFormat: source.format,
              targetWidth: request.targetWidth,
              targetHeight: request.targetHeight,
              maxBytes: request.maxBytes,
              fitMode: request.fitMode,
              background: request.background,
            },
            {
              onStart: () => {
                if (currentVersion(requestVersionsRef.current, item.id) !== version) return;
                updateJob(item.id, { request, status: { kind: "processing" } });
              },
            },
          );

          releaseNextTurn();

          const outcome = await outcomePromise;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return;

          if (outcome.status === "cancelled") {
            return;
          }
          if (outcome.status === "error") {
            updateJob(item.id, {
              request,
              status: { kind: "error", reason: "encode-failed", message: outcome.message },
            });
            return;
          }
          if (
            outcome.status === "unsupported-animation" ||
            outcome.status === "unsafe-dimensions" ||
            outcome.status === "invalid-request" ||
            outcome.status === "unsupported-encoder" ||
            outcome.status === "timeout"
          ) {
            updateJob(item.id, {
              request,
              status: { kind: "error", reason: outcome.status, message: errors[outcome.status] },
            });
            return;
          }

          if (outcome.status === "done") {
            const objectUrl = urlManagerRef.current!.create(
              targetFitUrlId(item.id),
              new Blob([outcome.candidate.jpegBuffer], { type: outcome.candidate.mimeType }),
            );
            const result = buildResult(
              outcome.candidate,
              request,
              source,
              outputFileName,
              objectUrl,
              outcome.encodeCount,
              outcome.elapsedMs,
            );
            updateJob(item.id, { request, status: { kind: "done", result } });
            return;
          }

          // unreachable: bestCandidateは必ず存在する(target-fit.worker.tsのfloor probeが保証する)。
          // 達成不能でもdownload可能な結果として提示する(該当条件をchecklist側で✗表示する)。
          const objectUrl = urlManagerRef.current!.create(
            targetFitBestCandidateUrlId(item.id),
            new Blob([outcome.bestCandidate.jpegBuffer], { type: outcome.bestCandidate.mimeType }),
          );
          const result = buildResult(
            outcome.bestCandidate,
            request,
            source,
            outputFileName,
            objectUrl,
            outcome.encodeCount,
            outcome.elapsedMs,
          );
          updateJob(item.id, { request, status: { kind: "unreachable", result } });
        } finally {
          releaseNextTurn();
        }
      })();
    },
    [isSupported, updateJob, errors, allowedSourceFormats],
  );

  const cancelTargetFit = useCallback((itemId: string) => {
    bumpVersion(requestVersionsRef.current, itemId);
    clientRef.current?.cancel(itemId);
    setJobs((prev) => {
      const current = prev[itemId];
      if (!current) return prev;
      if (current.status.kind !== "queued" && current.status.kind !== "processing") return prev;
      return { ...prev, [itemId]: { request: current.request, status: { kind: "cancelled" } } };
    });
  }, []);

  const removeJob = useCallback((itemId: string) => {
    bumpVersion(requestVersionsRef.current, itemId);
    clientRef.current?.cancel(itemId);
    urlManagerRef.current?.revoke(targetFitUrlId(itemId));
    urlManagerRef.current?.revoke(targetFitBestCandidateUrlId(itemId));
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

  const boundEligibilityFor = useCallback(
    (item: IntakeItem) => eligibilityFor(item, isSupported, allowedSourceFormats),
    [isSupported, allowedSourceFormats],
  );

  return {
    isSupported,
    jobs,
    eligibilityFor: boundEligibilityFor,
    startTargetFit,
    cancelTargetFit,
    removeJob,
    clearJobs,
  };
}
