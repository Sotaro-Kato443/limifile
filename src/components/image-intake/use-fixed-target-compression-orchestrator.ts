import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useImageCompression, type UseImageCompressionResult } from "./use-image-compression";
import { usePngCompression } from "../png-compression/use-png-compression";
import type { UsePngCompressionResult } from "../png-compression/use-png-compression";
import type {
  CompressionEligibility,
  CompressionFailureReason,
  CompressionJob,
  CompressionSource,
  CompressionTarget,
} from "./compression-types";
import type {
  PngCompressionEligibility,
  PngCompressionFailureReason,
  PngCompressionJob,
  PngCompressionSource,
} from "../png-compression/png-compression-ui-types";
import type { IntakeItem } from "./types";

type CompressionGroup = "jpeg-webp" | "png";

/**
 * アイテムがどちらの圧縮エンジンの対象になるかを判定する(振り分けのみ、値の抽出は行わない)。
 * JPEG本体・静止/アニメーションWebP・HEIC変換後JPEGはjpeg-webpグループ、PNGはpngグループ。
 * どちらでもない(解析中・未対応形式・エラー等)場合はnullを返す。実際のsource抽出・
 * 安全性検証(WebPアニメーション判定・寸法検証・APNG検出等)は各フックのeligibilityForに
 * 委譲し、ここでは重複させない。
 */
function formatGroupFor(item: IntakeItem): CompressionGroup | null {
  if (item.status.kind === "heic-done") return "jpeg-webp";
  if (item.status.kind === "ready" && item.detectedFormat === "jpeg") return "jpeg-webp";
  if (item.status.kind === "ready" && item.detectedFormat === "webp") return "jpeg-webp";
  if (item.status.kind === "ready" && item.detectedFormat === "png") return "png";
  return null;
}

export type MergedFixedTargetEligibility =
  | { kind: "not-ready" }
  | { kind: "unsupported-format" }
  | { kind: "unsupported-animation" }
  | { kind: "unsafe-dimensions" }
  | { kind: "unsupported-browser"; format: CompressionGroup }
  | { kind: "ready"; format: "jpeg-webp"; source: CompressionSource }
  | { kind: "ready"; format: "png"; source: PngCompressionSource };

export type MergedFixedTargetJob =
  { format: "jpeg-webp"; job: CompressionJob } | { format: "png"; job: PngCompressionJob };

interface PendingRequest {
  item: IntakeItem;
  target: CompressionTarget;
  group: CompressionGroup;
}

/** オーケストレーター自身がまだ下位フックへdispatchしていない要求の表示用ステータス */
type PreDispatchStatus = { kind: "queued" } | { kind: "cancelled" };

interface PreDispatchEntry {
  group: CompressionGroup;
  status: PreDispatchStatus;
}

export interface UseFixedTargetCompressionOrchestratorResult {
  isSupported: boolean;
  jobs: Record<string, MergedFixedTargetJob>;
  eligibilityFor(item: IntakeItem): MergedFixedTargetEligibility;
  startCompression(item: IntakeItem, target: CompressionTarget): void;
  cancelCompression(itemId: string): void;
  removeJob(itemId: string): void;
  clearJobs(): void;
}

function toMergedFixedTargetEligibility(
  group: CompressionGroup,
  eligibility: CompressionEligibility | PngCompressionEligibility,
): MergedFixedTargetEligibility {
  if (eligibility.kind === "ready") {
    if (group === "png") {
      return {
        kind: "ready",
        format: "png",
        source: (eligibility as { source: PngCompressionSource }).source,
      };
    }
    return {
      kind: "ready",
      format: "jpeg-webp",
      source: (eligibility as { source: CompressionSource }).source,
    };
  }
  if (eligibility.kind === "unsupported-browser") {
    return { kind: "unsupported-browser", format: group };
  }
  return eligibility;
}

const TERMINAL_JOB_KINDS = new Set(["done", "error", "cancelled", "unreachable"]);

/**
 * 固定容量ページ(/compress-image-to-{20,50,100,200,500}kb)共通の軽量オーケストレーター。
 * 目標容量(target)自体はこのフックの外(呼び出し側の各ページ)が決めており、このフック自身は
 * 特定の容量にひもづかない。
 *
 * JPEG/WebP用のuseImageCompression()とPNG用のusePngCompression()はそれぞれ独立した
 * Worker+FIFOを持つため、単純に両方を呼び出すだけでは「JPEGとPNGが同時に処理される」
 * ことが起こり得る。これらのページは複数形式を混在選択できるため、形式をまたいだ共通の
 * FIFO(1件ずつ、選択・開始順)をこのフックが保証する。実際の圧縮処理・安全性検証・
 * FIFO(単一形式内)・Object URL管理・stale結果防止は既存の各フックにすべて委譲し、
 * 同じロジックを重複させない。
 *
 * 仕組み: startCompressionは即座に下位フックを呼ばず、まず自分自身のqueueに積む。
 * 現在dispatch中のアイテム(activeId)が無い場合のみ、useEffectでqueueの先頭を
 * 実際に下位フックのstartCompressionへdispatchする。dispatch中アイテムのjobが
 * done/error/cancelled/unreachableのいずれかに達したら、完了検知effectがactiveIdを
 * 解放し、次のdispatchが進む。
 *
 * cancel/removeは、dispatch前(queue内で待機中、下位フックへは一切送っていない)なら
 * 自分のqueue/preDispatchから取り除くだけでよい。dispatch後(実行中)の場合はcancelと
 * removeで解放経路が異なる:
 * - cancel: 対応する下位フックのcancelCompressionを呼ぶだけで、activeIdはここでは
 *   解放しない。useImageCompression/usePngCompressionはどちらもrequest generation
 *   (バージョン)方式で強化済みで、arrayBuffer読み込み中・Worker待機中・実行中の
 *   いずれであっても呼び出し後は必ずjob.statusがcancelledへ遷移することが保証されている。
 *   そのcancelled遷移を下の完了検知effectが観測してactiveIdを解放する、という単一の
 *   解放経路に統一している。
 * - remove: 対応する下位フックのremoveJobはjobをMapから削除するだけで、
 *   done/error/cancelled等の終端ステータスへは遷移させない(削除後は表示するjob自体が
 *   無くなるため)。したがって完了検知effectでは削除を検出できず、removeJob側で
 *   下位フックのgenerationを無効化した直後にactiveIdをここで即座に解放する。
 */
export function useFixedTargetCompressionOrchestrator(
  jpegErrors: Record<CompressionFailureReason, string>,
  pngErrors: Record<PngCompressionFailureReason, string>,
): UseFixedTargetCompressionOrchestratorResult {
  const jpeg: UseImageCompressionResult = useImageCompression(jpegErrors);
  const png: UsePngCompressionResult = usePngCompression(pngErrors);

  const [queue, setQueue] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preDispatch, setPreDispatch] = useState<Record<string, PreDispatchEntry>>({});
  const requestsRef = useRef<Record<string, PendingRequest>>({});

  const eligibilityFor = useCallback(
    (item: IntakeItem): MergedFixedTargetEligibility => {
      const group = formatGroupFor(item);
      if (group === "png") return toMergedFixedTargetEligibility("png", png.eligibilityFor(item));
      if (group === "jpeg-webp")
        return toMergedFixedTargetEligibility("jpeg-webp", jpeg.eligibilityFor(item));
      // 未確定(解析中等)。JPEG/WebP側のeligibilityForはPNG専用の分岐を持たないため、
      // このケースでは常にnot-ready相当を返す(WebPの非同期チェック開始等の副作用も無害)。
      return toMergedFixedTargetEligibility("jpeg-webp", jpeg.eligibilityFor(item));
    },
    [jpeg.eligibilityFor, png.eligibilityFor],
  );

  const startCompression = useCallback(
    (item: IntakeItem, target: CompressionTarget) => {
      const group = formatGroupFor(item);
      if (!group) return;
      const eligibility = group === "png" ? png.eligibilityFor(item) : jpeg.eligibilityFor(item);
      if (eligibility.kind !== "ready") return;

      requestsRef.current[item.id] = { item, target, group };

      if (activeId === item.id) {
        // 同一アイテムの再圧縮(結果表示後に目標容量を変更して再度押した場合)。
        // dispatch済みの前回ジョブを打ち切り、キュー先頭へ差し戻して次のdispatchで送り直す。
        (group === "png" ? png.cancelCompression : jpeg.cancelCompression)(item.id);
        setActiveId(null);
        setPreDispatch((prev) => ({ ...prev, [item.id]: { group, status: { kind: "queued" } } }));
        setQueue((prev) => [item.id, ...prev.filter((id) => id !== item.id)]);
        return;
      }

      setPreDispatch((prev) => ({ ...prev, [item.id]: { group, status: { kind: "queued" } } }));
      setQueue((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
    },
    [
      activeId,
      jpeg.eligibilityFor,
      jpeg.cancelCompression,
      png.eligibilityFor,
      png.cancelCompression,
    ],
  );

  const cancelCompression = useCallback(
    (itemId: string) => {
      if (activeId === itemId) {
        const req = requestsRef.current[itemId];
        if (req) (req.group === "png" ? png.cancelCompression : jpeg.cancelCompression)(itemId);
        // activeIdはここでは解放しない。下位フックのjob状態がcancelledへ遷移したことを
        // 完了検知effectが観測してから解放することで、単一の解放経路に統一する
        // (dispatch前=queue内のキャンセルとは異なり、実際にjobが動いていた場合)。
        return;
      }
      // dispatch前(queue内で待機中)のキャンセル: 下位フックへは一切触れず、
      // 自分のqueueから除去したうえでcancelled状態を表示する
      setQueue((prev) => prev.filter((id) => id !== itemId));
      setPreDispatch((prev) => {
        const current = prev[itemId];
        if (!current || current.status.kind !== "queued") return prev;
        return { ...prev, [itemId]: { group: current.group, status: { kind: "cancelled" } } };
      });
    },
    [activeId, jpeg.cancelCompression, png.cancelCompression],
  );

  const removeJob = useCallback(
    (itemId: string) => {
      const req = requestsRef.current[itemId];
      const wasActive = activeId === itemId;
      if (req) (req.group === "png" ? png.removeJob : jpeg.removeJob)(itemId);
      delete requestsRef.current[itemId];
      setQueue((prev) => prev.filter((id) => id !== itemId));
      setPreDispatch((prev) => {
        if (!(itemId in prev)) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      // 実行中(dispatch済み)アイテムの削除は、下位フックのjob削除を待たずここで即座に
      // activeIdを解放する。下位フックのremoveJobはjobをMapから削除するだけで
      // done/error/cancelled等の終端ステータスへは遷移させないため、完了検知effectでは
      // 検出できない。
      if (wasActive) setActiveId(null);
    },
    [activeId, jpeg.removeJob, png.removeJob],
  );

  const clearJobs = useCallback(() => {
    requestsRef.current = {};
    setQueue([]);
    setPreDispatch({});
    setActiveId(null);
    jpeg.clearJobs();
    png.clearJobs();
  }, [jpeg.clearJobs, png.clearJobs]);

  // dispatch: activeIdが空いていて、queueに待機中のアイテムがあれば先頭を下位フックへ送る
  useEffect(() => {
    if (activeId !== null) return;
    if (queue.length === 0) return;
    const nextId = queue[0];
    setQueue((prev) => (prev.length > 0 && prev[0] === nextId ? prev.slice(1) : prev));
    setPreDispatch((prev) => {
      if (!(nextId in prev)) return prev;
      const next = { ...prev };
      delete next[nextId];
      return next;
    });
    const req = requestsRef.current[nextId];
    if (!req) return;
    setActiveId(nextId);
    if (req.group === "png") {
      png.startCompression(req.item, req.target);
    } else {
      jpeg.startCompression(req.item, req.target);
    }
  }, [activeId, queue, jpeg.startCompression, png.startCompression]);

  // 完了検知: dispatch中アイテムのjobが終端状態(done/error/cancelled/unreachable)に
  // 達したらactiveIdを解放し、上のdispatch effectが次のアイテムを送れるようにする
  useEffect(() => {
    if (activeId === null) return;
    const req = requestsRef.current[activeId];
    if (!req) return;
    const job = req.group === "png" ? png.jobs[activeId] : jpeg.jobs[activeId];
    if (!job) return;
    if (TERMINAL_JOB_KINDS.has(job.status.kind)) setActiveId(null);
  }, [activeId, jpeg.jobs, png.jobs]);

  const jobs = useMemo(() => {
    const merged: Record<string, MergedFixedTargetJob> = {};
    for (const [id, job] of Object.entries(jpeg.jobs)) merged[id] = { format: "jpeg-webp", job };
    for (const [id, job] of Object.entries(png.jobs)) merged[id] = { format: "png", job };
    for (const [id, entry] of Object.entries(preDispatch)) {
      if (entry.group === "png") {
        merged[id] = { format: "png", job: { status: entry.status } };
      } else {
        const target = requestsRef.current[id]?.target;
        if (target) merged[id] = { format: "jpeg-webp", job: { target, status: entry.status } };
      }
    }
    return merged;
  }, [jpeg.jobs, png.jobs, preDispatch]);

  return {
    isSupported: jpeg.isSupported || png.isSupported,
    jobs,
    eligibilityFor,
    startCompression,
    cancelCompression,
    removeJob,
    clearJobs,
  };
}
