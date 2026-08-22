import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createRemoveExifClient, type RemoveExifClient } from "./remove-exif-client";
import { createObjectUrlManager, type ObjectUrlManager } from "./object-url-manager";
import { removeExifOutputFileName } from "./remove-exif-output-filename";
import type {
  RemoveMetadataEligibility,
  RemoveMetadataJob,
  RemoveMetadataResult,
  RemoveMetadataSource,
} from "./remove-exif-types";
import type { IntakeItem } from "./types";

/** メタデータ削除に必要なブラウザ機能(Dedicated Worker)を同期的に判定する。UA文字列判定は行わない */
function detectRemoveExifSupport(): boolean {
  return typeof Worker !== "undefined";
}

function sourceFor(item: IntakeItem): RemoveMetadataSource | null {
  if (item.status.kind === "ready" && item.detectedFormat === "jpeg") {
    return {
      kind: "jpeg",
      blob: item.file,
      width: item.status.dimensions.width,
      height: item.status.dimensions.height,
    };
  }
  if (item.status.kind === "heic-done") {
    return {
      kind: "heic-derived-jpeg",
      blob: item.status.result.blob,
      width: item.status.result.width,
      height: item.status.result.height,
    };
  }
  return null;
}

/** アイテムのメタデータ削除対応可否を判定する。remove-exif-types.tsのRemoveMetadataEligibilityを参照 */
export function eligibilityFor(item: IntakeItem, isSupported: boolean): RemoveMetadataEligibility {
  if (!isSupported) return { kind: "unsupported-browser" };

  const source = sourceFor(item);
  if (source) return { kind: "ready", source };

  // allowedFormats(jpeg/heic、RemoveExifWorkbench.tsx参照)により、png/webp/avif等の対象外形式は
  // intake側で既に"unsupported-format"として拒否されている(item.status.kind === "ready"へは
  // 進まない)。detectedFormatが実在する値(null以外)であれば、このツール固有の案内文言を出す
  // (use-raster-to-jpg.tsのisWrongFormatRejectedと同じ設計)。detectedFormatがnull(そもそも
  // 画像として認識できない)場合は汎用文言に委ね、not-readyのまま返す。
  const isWrongFormatRejected =
    item.status.kind === "unsupported-format" && item.detectedFormat !== null;
  if (isWrongFormatRejected) {
    return { kind: "unsupported-format" };
  }

  return { kind: "not-ready" };
}

/** HEIC変換結果等のObject URLキーと衝突しないよう、削除結果専用の接尾辞を付与する */
function removeExifUrlId(itemId: string): string {
  return `${itemId}-remove-exif`;
}

export interface UseRemoveExifResult {
  isSupported: boolean;
  jobs: Record<string, RemoveMetadataJob>;
  eligibilityFor(item: IntakeItem): RemoveMetadataEligibility;
  startRemoval(item: IntakeItem): void;
  cancelRemoval(itemId: string): void;
  /** アイテム削除時に呼ぶ。実行中/待機中のジョブをキャンセルし、Object URLを解放する */
  removeJob(itemId: string): void;
  /** 全消去時に呼ぶ */
  clearJobs(): void;
}

/**
 * アイテムIDをキーにした独立したRemoveMetadataJob群を管理するフック。
 * 既存のIntakeItem/useImageIntakeの状態には一切書き込まない(状態管理を分離するため)。
 * 削除結果のObject URLは専用のObjectUrlManagerで管理し、HEIC変換結果等の既存Object URLの
 * ライフサイクルには影響しない。
 *
 * JPEG本体はメタデータ削除処理の中で再エンコードしないため、出力の寸法は常に入力(source)の
 * 寸法と一致する。HEIC由来の場合も、既存のHEIC→JPG変換結果Blobをそのまま入力にし、
 * HEICの再デコードは行わない。
 */
export function useRemoveExif(): UseRemoveExifResult {
  const [jobs, setJobs] = useState<Record<string, RemoveMetadataJob>>({});

  const isSupportedRef = useRef<boolean | undefined>(undefined);
  if (isSupportedRef.current === undefined) {
    isSupportedRef.current = detectRemoveExifSupport();
  }
  const isSupported = isSupportedRef.current;

  const clientRef = useRef<RemoveExifClient>();
  if (!clientRef.current && isSupported) {
    clientRef.current = createRemoveExifClient();
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

  const updateJob = useCallback((itemId: string, job: RemoveMetadataJob) => {
    setJobs((prev) => ({ ...prev, [itemId]: job }));
  }, []);

  const startRemoval = useCallback(
    (item: IntakeItem) => {
      const eligibility = eligibilityFor(item, isSupported);
      if (eligibility.kind !== "ready") return;
      const { source } = eligibility;

      // 同一アイテムに対する前回のジョブ(待機中/実行中)があれば、新しいジョブの前に必ず打ち切る
      clientRef.current?.cancel(item.id);

      const outputFileName = removeExifOutputFileName(item.file.name);
      const urlManager = urlManagerRef.current!;
      // 再処理の場合、直前の結果のObject URLを新しい結果へ置き換える前に解放する
      urlManager.revoke(removeExifUrlId(item.id));

      updateJob(item.id, { status: { kind: "queued" } });

      void (async () => {
        const buffer = await source.blob.arrayBuffer();
        const client = clientRef.current;
        if (!client) return;

        const outcome = await client.enqueue(
          { id: item.id, buffer },
          { onStart: () => updateJob(item.id, { status: { kind: "processing" } }) },
        );

        if (outcome.status === "cancelled") {
          // cancelRemoval/removeJob側で既にcancelled状態へ更新済みのため何もしない
          return;
        }
        if (outcome.status === "error") {
          updateJob(item.id, {
            status: { kind: "error", code: outcome.code, message: outcome.message },
          });
          return;
        }

        const outputBlob = new Blob([outcome.jpegBuffer], { type: "image/jpeg" });
        const objectUrl = urlManagerRef.current!.create(removeExifUrlId(item.id), outputBlob);
        const result: RemoveMetadataResult = {
          objectUrl,
          blob: outputBlob,
          outputFileName,
          originalBytes: outcome.originalBytes,
          outputBytes: outcome.outputBytes,
          originalWidth: source.width,
          originalHeight: source.height,
          outputWidth: source.width,
          outputHeight: source.height,
          orientationKept: outcome.orientationKept,
          iccKept: outcome.iccKept,
          elapsedMs: outcome.elapsedMs,
        };
        updateJob(item.id, { status: { kind: "done", result } });
      })();
    },
    [isSupported, updateJob],
  );

  const cancelRemoval = useCallback((itemId: string) => {
    const cancelled = clientRef.current?.cancel(itemId) ?? false;
    if (!cancelled) return;
    setJobs((prev) => {
      if (!(itemId in prev)) return prev;
      return { ...prev, [itemId]: { status: { kind: "cancelled" } } };
    });
  }, []);

  const removeJob = useCallback((itemId: string) => {
    clientRef.current?.cancel(itemId);
    urlManagerRef.current?.revoke(removeExifUrlId(itemId));
    setJobs((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  const clearJobs = useCallback(() => {
    clientRef.current?.cancelAll();
    urlManagerRef.current?.revokeAll();
    setJobs({});
  }, []);

  const boundEligibilityFor = useCallback(
    (item: IntakeItem) => eligibilityFor(item, isSupported),
    [isSupported],
  );

  return {
    isSupported,
    jobs,
    eligibilityFor: boundEligibilityFor,
    startRemoval,
    cancelRemoval,
    removeJob,
    clearJobs,
  };
}
