/// <reference lib="webworker" />
// PNG→WebP変換は必ずこのDedicated Worker内で実行する。メインスレッドでは呼び出さない。

import { detectApng } from "./apng-detection";
import {
  DECODE_SAFETY_LIMITS,
  dimensionsRoughlyMatch,
  validateDeclaredDimensions,
} from "./decode-safety";
import { readDeclaredDimensions } from "./image-header-dimensions";
import type { DeclaredDimensions } from "./image-header-dimensions";
import { isAllowedQuality } from "./png-to-webp-types";

declare const self: DedicatedWorkerGlobalScope;

export interface PngToWebpWorkerRequestMessage {
  id: string;
  buffer: ArrayBuffer;
  /** 0.10〜0.98の範囲を想定。1.0は使用しない(png-to-webp-types.ts参照) */
  quality: number;
}

export interface PngToWebpWorkerDoneMessage {
  id: string;
  type: "result";
  status: "done";
  webpBuffer: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
  elapsedMs: number;
}

/** アニメーションPNG(acTLチャンク)を検出し、createImageBitmap前に拒否した場合 */
export interface PngToWebpWorkerUnsupportedAnimationMessage {
  id: string;
  type: "result";
  status: "unsupported-animation";
}

/** PNGの構造自体が壊れている/PNGと判定できない場合。createImageBitmapは一切呼ばない */
export interface PngToWebpWorkerMalformedMessage {
  id: string;
  type: "result";
  status: "malformed-png";
}

/** デコード前の寸法・ピクセル数安全検証(decode-safety.ts)で拒否された場合 */
export interface PngToWebpWorkerUnsafeDimensionsMessage {
  id: string;
  type: "result";
  status: "unsafe-dimensions";
}

/** createImageBitmap後の実寸法が、IHDRの宣言寸法と一致しない場合(EXIF回転相当の入れ替わりは許容) */
export interface PngToWebpWorkerDimensionMismatchMessage {
  id: string;
  type: "result";
  status: "dimension-mismatch";
}

/** convertToBlobへimage/webpを指定したが、生成されたBlobのtypeがimage/webpではなかった場合 */
export interface PngToWebpWorkerUnsupportedEncoderMessage {
  id: string;
  type: "result";
  status: "unsupported-webp-encoder";
}

/** デコードまたはエンコードが時間予算を超過した場合 */
export interface PngToWebpWorkerTimeoutMessage {
  id: string;
  type: "result";
  status: "timeout";
}

/**
 * リクエストされたqualityがこのツールで許可する値(0.65/0.80/0.90)以外だった場合。
 * UI(png-to-webp-types.ts)から生成される値は常にこの3値のいずれかだが、Worker側が
 * 最終的な安全境界としてcreateImageBitmap前に必ず検証する。
 */
export interface PngToWebpWorkerInvalidQualityMessage {
  id: string;
  type: "result";
  status: "invalid-quality";
}

export interface PngToWebpWorkerErrorMessage {
  id: string;
  type: "result";
  status: "error";
  message: string;
}

export type PngToWebpWorkerResultMessage =
  | PngToWebpWorkerDoneMessage
  | PngToWebpWorkerUnsupportedAnimationMessage
  | PngToWebpWorkerMalformedMessage
  | PngToWebpWorkerUnsafeDimensionsMessage
  | PngToWebpWorkerDimensionMismatchMessage
  | PngToWebpWorkerUnsupportedEncoderMessage
  | PngToWebpWorkerTimeoutMessage
  | PngToWebpWorkerInvalidQualityMessage
  | PngToWebpWorkerErrorMessage;

export type PngToWebpOutcome =
  | {
      status: "done";
      webpBuffer: ArrayBuffer;
      width: number;
      height: number;
      quality: number;
      elapsedMs: number;
    }
  | { status: "dimension-mismatch" }
  | { status: "unsupported-webp-encoder" }
  | { status: "timeout" }
  | { status: "error"; message: string };

/** デコード・エンコードそれぞれに許す処理時間の上限(ミリ秒)。極端に巨大な画像で無制限に待たないための安全弁 */
const TIME_BUDGET_MS = 20000;
const WEBP_MIME_TYPE = "image/webp";
const PNG_MIME_TYPE = "image/png";

class TimeoutError extends Error {
  constructor() {
    super("処理が時間予算を超過しました");
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * PNG BlobをWebPへ変換する処理本体。self.onmessageから分離しているのは、単体テストで
 * createImageBitmap/OffscreenCanvasをモックしつつこの関数だけを直接検証できるようにするため。
 *
 * 目標容量探索は行わない(指定容量圧縮とは異なるMVP)。固定のquality値で1回だけエンコードする。
 * 呼び出し前提: 呼び出し側(self.onmessage)が既にAPNG判定・寸法安全性検証を完了していること。
 */
export async function convertPngBufferToWebp(
  buffer: ArrayBuffer,
  quality: number,
  /** ヘッダーから読み取った宣言寸法(省略時は照合を行わない) */
  declaredDimensions?: DeclaredDimensions | null,
  timeBudgetMs: number = TIME_BUDGET_MS,
): Promise<PngToWebpOutcome> {
  const startTime = Date.now();

  let bitmap: ImageBitmap;
  try {
    bitmap = await withTimeout(
      createImageBitmap(new Blob([buffer], { type: PNG_MIME_TYPE }), {
        imageOrientation: "from-image",
      }),
      timeBudgetMs,
    );
  } catch (error) {
    if (error instanceof TimeoutError) return { status: "timeout" };
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  const width = bitmap.width;
  const height = bitmap.height;

  if (declaredDimensions && !dimensionsRoughlyMatch(declaredDimensions, width, height)) {
    bitmap.close();
    return { status: "dimension-mismatch" };
  }

  let blob: Blob;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvasの2Dコンテキストを取得できませんでした");
    ctx.drawImage(bitmap, 0, 0);
    blob = await withTimeout(canvas.convertToBlob({ type: WEBP_MIME_TYPE, quality }), timeBudgetMs);
  } catch (error) {
    bitmap.close();
    if (error instanceof TimeoutError) return { status: "timeout" };
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  bitmap.close();

  if (blob.type !== WEBP_MIME_TYPE) {
    return { status: "unsupported-webp-encoder" };
  }

  const webpBuffer = await blob.arrayBuffer();
  return {
    status: "done",
    webpBuffer,
    width,
    height,
    quality,
    elapsedMs: Date.now() - startTime,
  };
}

self.onmessage = async (event: MessageEvent<PngToWebpWorkerRequestMessage>) => {
  const { id, buffer, quality } = event.data;
  try {
    // createImageBitmap(decode)前に、まずqualityがこのツールで許可する値かを検証する。
    // UI(png-to-webp-types.ts)は常に許可された値のみを送るはずだが、Worker側のこの検証こそが
    // 最終的な安全境界であり、不正なqualityがconvertToBlobへ渡ることを防ぐ。
    if (!isAllowedQuality(quality)) {
      const message: PngToWebpWorkerInvalidQualityMessage = {
        id,
        type: "result",
        status: "invalid-quality",
      };
      self.postMessage(message);
      return;
    }

    const bytes = new Uint8Array(buffer);

    // createImageBitmap(decode)前に、まずAPNG判定を行う。Worker側のこの判定こそが
    // 最終的な安全境界であり、フック側(use-png-to-webp.ts)の事前チェックはUIを早く
    // 更新するためのものに過ぎない(そちらを迂回・すり抜けても、ここで必ず
    // アニメーションPNGをcreateImageBitmapへ渡さない)。
    const apngCheck = detectApng(bytes);
    if (apngCheck === "animated") {
      const message: PngToWebpWorkerUnsupportedAnimationMessage = {
        id,
        type: "result",
        status: "unsupported-animation",
      };
      self.postMessage(message);
      return;
    }
    if (apngCheck === "malformed" || apngCheck === "not-png") {
      const message: PngToWebpWorkerMalformedMessage = {
        id,
        type: "result",
        status: "malformed-png",
      };
      self.postMessage(message);
      return;
    }

    // createImageBitmap(decode)前に、ヘッダーだけから宣言寸法を読み取り安全性を検証する。
    // ここで拒否された画像はcreateImageBitmapへ一切渡さない。
    const declaredDimensions = readDeclaredDimensions(bytes, "png");
    const safetyError = validateDeclaredDimensions(declaredDimensions, DECODE_SAFETY_LIMITS);
    if (safetyError) {
      const message: PngToWebpWorkerUnsafeDimensionsMessage = {
        id,
        type: "result",
        status: "unsafe-dimensions",
      };
      self.postMessage(message);
      return;
    }

    const outcome = await convertPngBufferToWebp(buffer, quality, declaredDimensions);

    if (outcome.status === "done") {
      const message: PngToWebpWorkerDoneMessage = {
        id,
        type: "result",
        status: "done",
        webpBuffer: outcome.webpBuffer,
        width: outcome.width,
        height: outcome.height,
        quality: outcome.quality,
        elapsedMs: outcome.elapsedMs,
      };
      self.postMessage(message, [outcome.webpBuffer]);
      return;
    }
    if (outcome.status === "dimension-mismatch") {
      const message: PngToWebpWorkerDimensionMismatchMessage = {
        id,
        type: "result",
        status: "dimension-mismatch",
      };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "unsupported-webp-encoder") {
      const message: PngToWebpWorkerUnsupportedEncoderMessage = {
        id,
        type: "result",
        status: "unsupported-webp-encoder",
      };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "timeout") {
      const message: PngToWebpWorkerTimeoutMessage = { id, type: "result", status: "timeout" };
      self.postMessage(message);
      return;
    }
    const message: PngToWebpWorkerErrorMessage = {
      id,
      type: "result",
      status: "error",
      message: outcome.message,
    };
    self.postMessage(message);
  } catch (error) {
    const message: PngToWebpWorkerErrorMessage = {
      id,
      type: "result",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(message);
  }
};
