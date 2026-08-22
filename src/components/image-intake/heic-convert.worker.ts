/// <reference lib="webworker" />
// HEICデコードは必ずこのDedicated Worker内で実行する。メインスレッドでは呼び出さない。
import decode from "@discourse/heic/decode";
import { DECODE_SAFETY_LIMITS } from "./decode-safety";
import { isAllowedHeicQuality } from "./heic-conversion-types";

declare const self: DedicatedWorkerGlobalScope;

export interface HeicConvertRequestMessage {
  id: string;
  buffer: ArrayBuffer;
  quality: number;
}

export interface HeicConvertDoneMessage {
  id: string;
  status: "done";
  jpegBuffer: ArrayBuffer;
  jpegType: string;
  width: number;
  height: number;
}

/**
 * リクエストされたqualityがこのツールで許可する値(HEIC_JPEG_QUALITY)以外だった場合。
 * UI(use-image-intake.ts)は常にHEIC_JPEG_QUALITYのみを送るはずだが、Worker側のこの検証こそが
 * 最終的な安全境界であり、decode()は一切呼ばない。
 */
export interface HeicConvertInvalidQualityMessage {
  id: string;
  status: "invalid-quality";
}

/** HEIC変換処理全体(decode+convertToBlob)が時間予算を超過した場合 */
export interface HeicConvertTimeoutMessage {
  id: string;
  status: "timeout";
}

/**
 * decode()完了後のImageDataが安全上限を超える、または壊れている場合。
 * HEICはデコードするまで寸法が分からないため、この検証は「デコード前の完全な防御」ではなく、
 * デコード直後・OffscreenCanvas作成前の最終防御である。
 */
export interface HeicConvertUnsafeDimensionsMessage {
  id: string;
  status: "unsafe-dimensions";
}

/** convertToBlobへimage/jpegを指定したが、生成されたBlobがimage/jpegでない、または空だった場合 */
export interface HeicConvertUnsupportedEncoderMessage {
  id: string;
  status: "unsupported-jpeg-encoder";
}

export interface HeicConvertErrorMessage {
  id: string;
  status: "error";
  message: string;
}

export type HeicConvertResultMessage =
  | HeicConvertDoneMessage
  | HeicConvertInvalidQualityMessage
  | HeicConvertTimeoutMessage
  | HeicConvertUnsafeDimensionsMessage
  | HeicConvertUnsupportedEncoderMessage
  | HeicConvertErrorMessage;

export type ConvertHeicOutcome =
  | { status: "done"; jpegBuffer: ArrayBuffer; jpegType: string; width: number; height: number }
  | { status: "unsafe-dimensions" }
  | { status: "unsupported-jpeg-encoder" }
  | { status: "timeout" }
  | { status: "error"; message: string };

/**
 * HEIC変換処理全体(decode+convertToBlob)に許す処理時間の上限(ミリ秒)。
 * decodeとconvertToBlobそれぞれに個別の予算を与えるのではなく、両工程で同一のdeadlineを
 * 共有する(decode完了後、残り時間だけをconvertToBlobへ与える)。極端に巨大/破損した
 * HEICで無制限に待たないための安全弁。クライアント側バックストップ(35秒、
 * heic-conversion-client.tsのCLIENT_TIMEOUT_MS)より必ず小さい値にすること
 * (Worker自身のtimeout応答がクライアント側backstopより先に返るようにするため)。
 */
export const TIME_BUDGET_MS = 30000;
const JPEG_MIME_TYPE = "image/jpeg";

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
 * decode()が返したImageDataの寸法・データ長を検証する。既存のDECODE_SAFETY_LIMITS
 * (maxDimension/maxPixels)をJPEG/PNG/WebPと同じ基準で再利用する。
 * HEICはデコードするまで寸法を得られないため、この関数はデコード前の防御ではなく、
 * OffscreenCanvas作成前の最終防御として働く(コメントの通り「完全な事前防御」ではない)。
 */
function isSafeImageData(imageData: ImageData): boolean {
  const { width, height } = imageData;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width > DECODE_SAFETY_LIMITS.maxDimension || height > DECODE_SAFETY_LIMITS.maxDimension) {
    return false;
  }

  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount)) return false;
  if (pixelCount > DECODE_SAFETY_LIMITS.maxPixels) return false;

  const byteLength = pixelCount * 4;
  if (!Number.isSafeInteger(byteLength)) return false;
  if (imageData.data.length !== byteLength) return false;

  return true;
}

/**
 * HEICバイト列をJPEGへ変換する処理本体。self.onmessageから分離しているのは、単体テストで
 * @discourse/heic/decodeをモックしつつこの関数だけを直接検証できるようにするため。
 * 呼び出し前提: 呼び出し側(self.onmessage)が既にquality検証を完了していること。
 *
 * decode・convertToBlobは個別の時間予算を持たず、呼び出し開始時刻から
 * timeBudgetMs後のdeadlineを共有する。decode完了後は残り時間だけをconvertToBlobへ与え、
 * 残り時間が0以下ならconvertToBlobを一切呼び出さずtimeoutを返す。
 * nowはテスト容易性のため注入可能にしている(既定はDate.now)。
 */
export async function convertHeicBufferToJpeg(
  buffer: ArrayBuffer,
  quality: number,
  timeBudgetMs: number = TIME_BUDGET_MS,
  now: () => number = Date.now,
): Promise<ConvertHeicOutcome> {
  const deadline = now() + timeBudgetMs;

  let imageData: ImageData;
  try {
    imageData = await withTimeout(decode(buffer), deadline - now());
  } catch (error) {
    if (error instanceof TimeoutError) return { status: "timeout" };
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  if (!isSafeImageData(imageData)) {
    return { status: "unsafe-dimensions" };
  }

  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { status: "error", message: "OffscreenCanvasの2Dコンテキストを取得できませんでした" };
  }
  ctx.putImageData(imageData, 0, 0);

  // decodeで時間予算の大半・全部を使い切っていた場合、convertToBlobを一切開始せず
  // timeoutを返す(decode+encodeの合計をdeadline一つで管理するための境界チェック)。
  const remainingMs = deadline - now();
  if (remainingMs <= 0) {
    return { status: "timeout" };
  }

  let jpegBlob: Blob;
  try {
    jpegBlob = await withTimeout(
      canvas.convertToBlob({ type: JPEG_MIME_TYPE, quality }),
      remainingMs,
    );
  } catch (error) {
    if (error instanceof TimeoutError) return { status: "timeout" };
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  if (jpegBlob.type !== JPEG_MIME_TYPE || jpegBlob.size === 0) {
    return { status: "unsupported-jpeg-encoder" };
  }

  const jpegBuffer = await jpegBlob.arrayBuffer();
  if (jpegBuffer.byteLength === 0) {
    return { status: "unsupported-jpeg-encoder" };
  }

  return {
    status: "done",
    jpegBuffer,
    jpegType: jpegBlob.type,
    width: imageData.width,
    height: imageData.height,
  };
}

self.onmessage = async (event: MessageEvent<HeicConvertRequestMessage>) => {
  const { id, buffer, quality } = event.data;
  try {
    // decode()前に、まずqualityがこのツールで許可する値かを検証する。Worker側のこの検証こそが
    // 最終的な安全境界であり、不正なqualityがconvertToBlobへ渡ることを防ぐ。
    if (!isAllowedHeicQuality(quality)) {
      const message: HeicConvertInvalidQualityMessage = { id, status: "invalid-quality" };
      self.postMessage(message);
      return;
    }

    const outcome = await convertHeicBufferToJpeg(buffer, quality);

    if (outcome.status === "done") {
      const message: HeicConvertDoneMessage = {
        id,
        status: "done",
        jpegBuffer: outcome.jpegBuffer,
        jpegType: outcome.jpegType,
        width: outcome.width,
        height: outcome.height,
      };
      self.postMessage(message, [outcome.jpegBuffer]);
      return;
    }
    if (outcome.status === "unsafe-dimensions") {
      const message: HeicConvertUnsafeDimensionsMessage = { id, status: "unsafe-dimensions" };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "unsupported-jpeg-encoder") {
      const message: HeicConvertUnsupportedEncoderMessage = {
        id,
        status: "unsupported-jpeg-encoder",
      };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "timeout") {
      const message: HeicConvertTimeoutMessage = { id, status: "timeout" };
      self.postMessage(message);
      return;
    }
    const message: HeicConvertErrorMessage = { id, status: "error", message: outcome.message };
    self.postMessage(message);
  } catch (error) {
    const message: HeicConvertErrorMessage = {
      id,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(message);
  }
};
