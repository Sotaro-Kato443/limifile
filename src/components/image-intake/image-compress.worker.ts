/// <reference lib="webworker" />
// JPEG・WebP圧縮は必ずこのDedicated Worker内で実行する。メインスレッドでは呼び出さない(MVPではフォールバック無し)。

import {
  DECODE_SAFETY_LIMITS,
  dimensionsRoughlyMatch,
  validateDeclaredDimensions,
} from "./decode-safety";
import { compressWebpBufferToTarget, DEFAULT_WEBP_COMPRESS_LIMITS } from "./image-compress-webp";
import { readDeclaredDimensions } from "./image-header-dimensions";
import { detectWebpAnimation } from "./webp-animation-detection";
import type { DeclaredDimensions } from "./image-header-dimensions";

declare const self: DedicatedWorkerGlobalScope;

/** formatを省略した場合は既存のJPEG専用呼び出しと完全互換(既定"jpeg") */
export interface CompressWorkerRequestMessage {
  id: string;
  buffer: ArrayBuffer;
  targetBytes: number;
  format?: "jpeg" | "webp";
}

export interface CompressWorkerDoneMessage {
  id: string;
  type: "result";
  status: "done";
  jpegBuffer: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
  encodeCount: number;
  resizeCount: number;
  elapsedMs: number;
}

export interface CompressWorkerWebpDoneMessage {
  id: string;
  type: "result";
  status: "webp-done";
  webpBuffer: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
  encodeCount: number;
  resizeCount: number;
  elapsedMs: number;
}

export interface CompressWorkerUnreachableMessage {
  id: string;
  type: "result";
  status: "unreachable";
  encodeCount: number;
  resizeCount: number;
  elapsedMs: number;
}

export interface CompressWorkerErrorMessage {
  id: string;
  type: "result";
  status: "error";
  message: string;
}

/** デコード前の寸法・ピクセル数安全検証(decode-safety.ts)で拒否された場合 */
export interface CompressWorkerUnsafeDimensionsMessage {
  id: string;
  type: "result";
  status: "unsafe-dimensions";
}

/** convertToBlobへimage/webpを指定したが、生成されたBlobのtypeがimage/webpではなかった場合 */
export interface CompressWorkerUnsupportedWebpEncoderMessage {
  id: string;
  type: "result";
  status: "unsupported-webp-encoder";
}

/** アニメーションWebP(VP8X animation flag / ANIM / ANMFチャンク)を検出し、createImageBitmap前に拒否した場合 */
export interface CompressWorkerUnsupportedAnimationMessage {
  id: string;
  type: "result";
  status: "unsupported-animation";
}

/** WebPのRIFF構造自体が壊れている/WebPと判定できない場合。createImageBitmapは一切呼ばない */
export interface CompressWorkerMalformedWebpMessage {
  id: string;
  type: "result";
  status: "malformed-webp";
}

/** createImageBitmap後の実寸法が、ヘッダーの宣言寸法と一致しない場合(EXIF回転による入れ替わりは許容) */
export interface CompressWorkerDimensionMismatchMessage {
  id: string;
  type: "result";
  status: "dimension-mismatch";
}

export type CompressionPhase = "preparing" | "quality" | "resize" | "finalizing";

export interface CompressWorkerProgressMessage {
  id: string;
  type: "progress";
  phase: CompressionPhase;
  attempt: number;
  maxAttempts: number;
}

export type CompressWorkerResultMessage =
  | CompressWorkerDoneMessage
  | CompressWorkerWebpDoneMessage
  | CompressWorkerUnreachableMessage
  | CompressWorkerErrorMessage
  | CompressWorkerUnsafeDimensionsMessage
  | CompressWorkerUnsupportedWebpEncoderMessage
  | CompressWorkerUnsupportedAnimationMessage
  | CompressWorkerMalformedWebpMessage
  | CompressWorkerDimensionMismatchMessage;

export interface CompressLimits {
  /** 1段階あたりの品質探索(二分探索)の最大反復回数 */
  maxQualityIterationsPerStage: number;
  /** 寸法縮小の最大回数 */
  maxResizeAttempts: number;
  /** エンコード(convertToBlob呼び出し)の合計上限。段階をまたいでも必ずこれ以下に収める */
  maxTotalEncodes: number;
  /** これより短い辺には縮小しない */
  minDimension: number;
  /** JPEG品質の探索範囲 */
  qualityRange: [number, number];
  /** 処理時間の上限(ミリ秒)。極端な目標へ無制限に反復しないための安全弁 */
  timeBudgetMs: number;
}

export const DEFAULT_COMPRESS_LIMITS: CompressLimits = {
  maxQualityIterationsPerStage: 6,
  maxResizeAttempts: 3,
  maxTotalEncodes: 12,
  minDimension: 320,
  qualityRange: [0.35, 0.92],
  timeBudgetMs: 20000,
};

/** 比率推定による縮小のオーバーシュートを避けるための安全係数(推定寸法をわずかに小さめに倒す) */
const RESIZE_SAFETY_FACTOR = 0.92;

export type CompressOutcome =
  | {
      status: "done";
      jpegBuffer: ArrayBuffer;
      width: number;
      height: number;
      quality: number;
      encodeCount: number;
      resizeCount: number;
      elapsedMs: number;
    }
  | { status: "unreachable"; encodeCount: number; resizeCount: number; elapsedMs: number }
  | { status: "error"; message: string }
  | { status: "dimension-mismatch" };

interface Candidate {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}

/**
 * JPEG BlobをtargetBytes以下へ圧縮する処理本体。self.onmessageから分離しているのは、
 * 単体テストでcreateImageBitmap/OffscreenCanvasをモックしつつこの関数だけを直接検証できるようにするため。
 *
 * 呼び出し前提: 入力Blobは既にtargetBytesを超えていること(既に目標以下ならこの関数を呼ばず、
 * 元Blobをそのまま結果として使う「無変更」の高速経路をクライアント側で処理する)。
 *
 * 手順: (1)1回だけデコード (2)元寸法で品質探索 (3)超過する場合のみ、現在サイズと目標の比率
 * (sqrt(target/current)に安全係数を掛けた値)から縮小後の寸法を一度に推定 (4)その寸法で再度品質探索
 * (5)必要な場合のみ追加で寸法を補正、を最大maxResizeAttempts回繰り返す。
 * size<=targetBytesになった候補のみを追跡し、そのうち最もサイズが大きい(=品質が高い)ものを採用する。
 */
export type CompressProgressCallback = (progress: {
  phase: CompressionPhase;
  attempt: number;
  maxAttempts: number;
}) => void;

export async function compressJpegBufferToTarget(
  buffer: ArrayBuffer,
  targetBytes: number,
  limits: CompressLimits = DEFAULT_COMPRESS_LIMITS,
  onProgress?: CompressProgressCallback,
  /**
   * ヘッダーから読み取った宣言寸法(省略時は照合を行わない。既存呼び出しとの完全互換のため)。
   * createImageBitmap後、実際のbitmap.width/heightと照合し、一致しない場合は
   * dimension-mismatchとして処理を拒否する(EXIF Orientationによる幅高さの入れ替わりは許容する)。
   */
  declaredDimensions?: DeclaredDimensions | null,
): Promise<CompressOutcome> {
  const startTime = Date.now();
  const stats = { encodeCount: 0, resizeCount: 0 };
  const [qualityLo, qualityHi] = limits.qualityRange;

  const timeExceeded = (): boolean => Date.now() - startTime > limits.timeBudgetMs;
  const budgetExhausted = (): boolean =>
    stats.encodeCount >= limits.maxTotalEncodes || timeExceeded();

  onProgress?.({ phase: "preparing", attempt: 0, maxAttempts: limits.maxTotalEncodes });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: "image/jpeg" }), {
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
  // ネストした非同期クロージャ内での再代入によりTypeScriptの型絞り込みが崩れるのを避けるため、
  // 生の変数ではなくミュータブルなオブジェクトのプロパティとして保持する
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
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.size <= targetBytes && (!bestRef.current || blob.size > bestRef.current.blob.size)) {
      bestRef.current = { blob, width, height, quality };
    }
    return blob;
  };

  // 品質探索は最大でmaxQualityIterationsPerStage回だが、それを毎段階そのまま使うと
  // 「元寸法での探索」+「1回のリサイズ後の探索」だけでmaxTotalEncodesを使い切ってしまい、
  // maxResizeAttempts(最大3回)を満たす前に必ず打ち切られてしまう(合計エンコード上限との整合性が崩れる)。
  // そのため、残りエンコード数を残り段階数で均等に割り、各段階の反復回数を動的に決める
  // (どの段階でもmaxQualityIterationsPerStageを超えない、という上限自体は維持したまま)。
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
      // エンコード結果は品質に対して必ずしも単調減少ではないため、判定は size<=targetBytes の事実のみに基づく
      if (blob.size <= targetBytes) {
        lo = quality;
      } else {
        hi = quality;
      }
    }
    return lastBlob;
  };

  // 第1段階: 元寸法のまま品質探索
  let referenceBlob = await qualitySearchAt(originalWidth, originalHeight, "quality");

  // 第2段階: 品質探索だけで届かない場合のみ、比率推定で寸法を縮小
  let width = originalWidth;
  let height = originalHeight;

  for (
    let resizeStep = 0;
    !bestRef.current && resizeStep < limits.maxResizeAttempts && !budgetExhausted();
    resizeStep++
  ) {
    if (!referenceBlob || referenceBlob.size <= 0) break;

    const rawScale = Math.sqrt(targetBytes / referenceBlob.size) * RESIZE_SAFETY_FACTOR;
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

  const jpegBuffer = await finalBest.blob.arrayBuffer();
  return {
    status: "done",
    jpegBuffer,
    width: finalBest.width,
    height: finalBest.height,
    quality: Math.round(finalBest.quality * 100) / 100,
    encodeCount: stats.encodeCount,
    resizeCount: stats.resizeCount,
    elapsedMs: Date.now() - startTime,
  };
}

self.onmessage = async (event: MessageEvent<CompressWorkerRequestMessage>) => {
  const { id, buffer, targetBytes, format = "jpeg" } = event.data;
  try {
    const bytes = new Uint8Array(buffer);

    // WebPはcreateImageBitmap(decode)前に、まずアニメーション判定を行う。
    // Worker側のこの判定こそが最終的な安全境界であり、フック側(use-image-compression.ts)の
    // 事前チェックはUIを早く更新するためのものに過ぎない(そちらを迂回・すり抜けても、
    // ここで必ずアニメーションWebPをcreateImageBitmapへ渡さない)。
    if (format === "webp") {
      const animationCheck = detectWebpAnimation(bytes);
      if (animationCheck === "animated") {
        const message: CompressWorkerUnsupportedAnimationMessage = {
          id,
          type: "result",
          status: "unsupported-animation",
        };
        self.postMessage(message);
        return;
      }
      if (animationCheck === "malformed" || animationCheck === "not-webp") {
        const message: CompressWorkerMalformedWebpMessage = {
          id,
          type: "result",
          status: "malformed-webp",
        };
        self.postMessage(message);
        return;
      }
    }

    // createImageBitmap(decode)前に、ヘッダーだけから宣言寸法を読み取り安全性を検証する。
    // ここで拒否された画像はcreateImageBitmapへ一切渡さない。
    const declaredDimensions = readDeclaredDimensions(bytes, format);
    const safetyError = validateDeclaredDimensions(declaredDimensions, DECODE_SAFETY_LIMITS);
    if (safetyError) {
      const message: CompressWorkerUnsafeDimensionsMessage = {
        id,
        type: "result",
        status: "unsafe-dimensions",
      };
      self.postMessage(message);
      return;
    }

    if (format === "webp") {
      const outcome = await compressWebpBufferToTarget(
        buffer,
        targetBytes,
        DEFAULT_WEBP_COMPRESS_LIMITS,
        (progress) => {
          const message: CompressWorkerProgressMessage = { id, type: "progress", ...progress };
          self.postMessage(message);
        },
        declaredDimensions,
      );
      if (outcome.status === "done") {
        const message: CompressWorkerWebpDoneMessage = {
          id,
          type: "result",
          status: "webp-done",
          webpBuffer: outcome.webpBuffer,
          width: outcome.width,
          height: outcome.height,
          quality: outcome.quality,
          encodeCount: outcome.encodeCount,
          resizeCount: outcome.resizeCount,
          elapsedMs: outcome.elapsedMs,
        };
        self.postMessage(message, [outcome.webpBuffer]);
      } else if (outcome.status === "unsupported-webp-encoder") {
        const message: CompressWorkerUnsupportedWebpEncoderMessage = {
          id,
          type: "result",
          status: "unsupported-webp-encoder",
        };
        self.postMessage(message);
      } else if (outcome.status === "dimension-mismatch") {
        const message: CompressWorkerDimensionMismatchMessage = {
          id,
          type: "result",
          status: "dimension-mismatch",
        };
        self.postMessage(message);
      } else {
        const message: CompressWorkerUnreachableMessage | CompressWorkerErrorMessage = {
          id,
          type: "result",
          ...outcome,
        };
        self.postMessage(message);
      }
      return;
    }

    const outcome = await compressJpegBufferToTarget(
      buffer,
      targetBytes,
      DEFAULT_COMPRESS_LIMITS,
      (progress) => {
        const message: CompressWorkerProgressMessage = { id, type: "progress", ...progress };
        self.postMessage(message);
      },
      declaredDimensions,
    );
    if (outcome.status === "done") {
      const message: CompressWorkerDoneMessage = { id, type: "result", ...outcome };
      self.postMessage(message, [outcome.jpegBuffer]);
    } else if (outcome.status === "dimension-mismatch") {
      const message: CompressWorkerDimensionMismatchMessage = {
        id,
        type: "result",
        status: "dimension-mismatch",
      };
      self.postMessage(message);
    } else {
      const message: CompressWorkerUnreachableMessage | CompressWorkerErrorMessage = {
        id,
        type: "result",
        ...outcome,
      };
      self.postMessage(message);
    }
  } catch (error) {
    const message: CompressWorkerErrorMessage = {
      id,
      type: "result",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(message);
  }
};
