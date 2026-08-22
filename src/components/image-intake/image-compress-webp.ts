/// <reference lib="webworker" />
// WebP圧縮は必ずDedicated Worker内で実行する。メインスレッドでは呼び出さない(JPEG同様、MVPではフォールバック無し)。

import { dimensionsRoughlyMatch } from "./decode-safety";
import type { CompressionPhase, CompressProgressCallback } from "./image-compress.worker";
import type { DeclaredDimensions } from "./image-header-dimensions";

export interface WebpCompressLimits {
  /** 1段階あたりの品質探索(二分探索)の最大反復回数 */
  maxQualityIterationsPerStage: number;
  /** 寸法縮小の最大回数 */
  maxResizeAttempts: number;
  /** エンコード(convertToBlob呼び出し)の合計上限。段階をまたいでも必ずこれ以下に収める */
  maxTotalEncodes: number;
  /** これより短い辺には縮小しない */
  minDimension: number;
  /** WebP品質の探索範囲。1.0は使用しない(下記参照) */
  qualityRange: [number, number];
  /** 処理時間の上限(ミリ秒) */
  timeBudgetMs: number;
}

/**
 * quality探索の上限を0.98に留める。実ブラウザ検証で、convertToBlobへquality:1(または未指定)を
 * 渡すとquality:0.99より明らかに小さい出力になる実装差(ブラウザ既定値へのフォールバックと見られる挙動)を
 * 確認しており、1.0を探索範囲に含めるとサイズに対する品質の単調性が崩れ、二分探索が破綻するため。
 */
export const DEFAULT_WEBP_COMPRESS_LIMITS: WebpCompressLimits = {
  maxQualityIterationsPerStage: 6,
  maxResizeAttempts: 3,
  maxTotalEncodes: 12,
  minDimension: 320,
  qualityRange: [0.1, 0.98],
  timeBudgetMs: 20000,
};

/** 比率推定による縮小のオーバーシュートを避けるための安全係数。JPEG側の定数とは独立に保持する */
const WEBP_RESIZE_SAFETY_FACTOR = 0.92;

const WEBP_MIME_TYPE = "image/webp";

export type WebpCompressOutcome =
  | {
      status: "done";
      webpBuffer: ArrayBuffer;
      width: number;
      height: number;
      quality: number;
      encodeCount: number;
      resizeCount: number;
      elapsedMs: number;
    }
  | { status: "unreachable"; encodeCount: number; resizeCount: number; elapsedMs: number }
  | { status: "unsupported-webp-encoder" }
  | { status: "error"; message: string }
  | { status: "dimension-mismatch" };

interface Candidate {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}

/** ブラウザがimage/webpのエンコードに対応していない(別形式へフォールバックした)ことを示す内部シグナル */
class UnsupportedWebpEncoderError extends Error {
  constructor() {
    super("convertToBlobがimage/webp以外のtypeを返しました");
    this.name = "UnsupportedWebpEncoderError";
  }
}

/**
 * WebP BlobをtargetBytes以下へ圧縮する処理本体。JPEG用のcompressJpegBufferToTargetと同じ
 * 「品質二分探索→必要なら比率推定で縮小」という骨格を踏襲しつつ、WebP専用の定数・MIME検証を持つ
 * 独立した実装として保持する(JPEGの結果・探索回数に影響を与えないため)。
 *
 * 呼び出し前提: 入力Blobは既にtargetBytesを超えていること。
 */
export async function compressWebpBufferToTarget(
  buffer: ArrayBuffer,
  targetBytes: number,
  limits: WebpCompressLimits = DEFAULT_WEBP_COMPRESS_LIMITS,
  onProgress?: CompressProgressCallback,
  /**
   * ヘッダーから読み取った宣言寸法(省略時は照合を行わない。既存呼び出しとの完全互換のため)。
   * createImageBitmap後、実際のbitmap.width/heightと照合し、一致しない場合は
   * dimension-mismatchとして処理を拒否する。
   */
  declaredDimensions?: DeclaredDimensions | null,
): Promise<WebpCompressOutcome> {
  const startTime = Date.now();
  const stats = { encodeCount: 0, resizeCount: 0 };
  const [qualityLo, qualityHi] = limits.qualityRange;

  const timeExceeded = (): boolean => Date.now() - startTime > limits.timeBudgetMs;
  const budgetExhausted = (): boolean =>
    stats.encodeCount >= limits.maxTotalEncodes || timeExceeded();

  onProgress?.({ phase: "preparing", attempt: 0, maxAttempts: limits.maxTotalEncodes });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: WEBP_MIME_TYPE }), {
      imageOrientation: "from-image",
    });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  if (
    declaredDimensions &&
    !dimensionsRoughlyMatch(declaredDimensions, bitmap.width, bitmap.height)
  ) {
    bitmap.close();
    return { status: "dimension-mismatch" };
  }

  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const bestRef: { current: Candidate | null } = { current: null };

  const encodeAt = async (
    width: number,
    height: number,
    quality: number,
    phase: CompressionPhase,
  ): Promise<Blob | null> => {
    if (budgetExhausted()) return null;
    stats.encodeCount++;
    onProgress?.({ phase, attempt: stats.encodeCount, maxAttempts: limits.maxTotalEncodes });
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvasの2Dコンテキストを取得できませんでした");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: WEBP_MIME_TYPE, quality });
    if (blob.type !== WEBP_MIME_TYPE) {
      throw new UnsupportedWebpEncoderError();
    }
    if (blob.size <= targetBytes && (!bestRef.current || blob.size > bestRef.current.blob.size)) {
      bestRef.current = { blob, width, height, quality };
    }
    return blob;
  };

  const totalStages = 1 + limits.maxResizeAttempts;
  let stagesStarted = 0;

  const nextStageIterations = (): number => {
    stagesStarted += 1;
    const remainingStages = Math.max(1, totalStages - stagesStarted + 1);
    const remainingBudget = Math.max(0, limits.maxTotalEncodes - stats.encodeCount);
    return Math.max(
      1,
      Math.min(limits.maxQualityIterationsPerStage, Math.ceil(remainingBudget / remainingStages)),
    );
  };

  const qualitySearchAt = async (
    width: number,
    height: number,
    phase: CompressionPhase,
  ): Promise<Blob | null> => {
    let lo = qualityLo;
    let hi = qualityHi;
    let lastBlob: Blob | null = null;
    const maxIterations = nextStageIterations();
    for (let i = 0; i < maxIterations; i++) {
      if (budgetExhausted()) break;
      const quality = (lo + hi) / 2;
      const blob = await encodeAt(width, height, quality, phase);
      if (!blob) break;
      lastBlob = blob;
      if (blob.size <= targetBytes) {
        lo = quality;
      } else {
        hi = quality;
      }
    }
    return lastBlob;
  };

  try {
    let referenceBlob = await qualitySearchAt(originalWidth, originalHeight, "quality");

    let width = originalWidth;
    let height = originalHeight;

    for (
      let resizeStep = 0;
      !bestRef.current && resizeStep < limits.maxResizeAttempts && !budgetExhausted();
      resizeStep++
    ) {
      if (!referenceBlob || referenceBlob.size <= 0) break;

      const rawScale = Math.sqrt(targetBytes / referenceBlob.size) * WEBP_RESIZE_SAFETY_FACTOR;
      const minScale = limits.minDimension / Math.min(width, height);
      const scale = Math.min(1, Math.max(rawScale, minScale));
      const nextWidth = Math.max(1, Math.round(width * scale));
      const nextHeight = Math.max(1, Math.round(height * scale));
      if (nextWidth === width && nextHeight === height) break;

      width = nextWidth;
      height = nextHeight;
      stats.resizeCount++;

      referenceBlob = await qualitySearchAt(width, height, "resize");

      if (Math.min(width, height) <= limits.minDimension) break;
    }
  } catch (error) {
    bitmap.close();
    if (error instanceof UnsupportedWebpEncoderError) {
      return { status: "unsupported-webp-encoder" };
    }
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  onProgress?.({
    phase: "finalizing",
    attempt: stats.encodeCount,
    maxAttempts: limits.maxTotalEncodes,
  });

  bitmap.close();

  const finalBest = bestRef.current;

  if (!finalBest) {
    return {
      status: "unreachable",
      encodeCount: stats.encodeCount,
      resizeCount: stats.resizeCount,
      elapsedMs: Date.now() - startTime,
    };
  }

  const webpBuffer = await finalBest.blob.arrayBuffer();
  return {
    status: "done",
    webpBuffer,
    width: finalBest.width,
    height: finalBest.height,
    quality: Math.round(finalBest.quality * 100) / 100,
    encodeCount: stats.encodeCount,
    resizeCount: stats.resizeCount,
    elapsedMs: Date.now() - startTime,
  };
}
