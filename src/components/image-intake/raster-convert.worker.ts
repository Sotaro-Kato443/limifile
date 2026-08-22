/// <reference lib="webworker" />
// PNG/WebP/AVIF→JPG変換は必ずこのDedicated Worker内で実行する。メインスレッドでは呼び出さない。
//
// png-to-webp.worker.tsと同じ安全設計(quality検証→アニメーション判定→寸法安全性検証→
// createImageBitmap→寸法照合→エンコード→エンコーダfallback検出、のすべてをcreateImageBitmap前の
// 判定から順に行う)を踏襲しつつ、入力形式(PNG/WebP/AVIF)をパラメータ化した共通実装。
// 出力はJPEG固定(JPEGはアルファチャンネルを持たないため、透明部分は指定された背景色で
// 塗りつぶしてからエンコードする)。将来のJPG→PNG・WebP→PNG等の追加時は、
// 入力形式の分岐(SOURCE_MIME_TYPE・アニメーション判定)を増やす形で拡張できる。
//
// AVIFはPNG/WebPと寸法安全性検証の形が異なる。PNG/WebPは単一のDeclaredDimensionsをヘッダーから
// 読み取って検証するが、AVIFはavif-isobmff.tsのispe候補(複数あり得る)を個別に検証する
// (use-image-intake.tsのanalyze()と同じ理由・同じ方式。clap/irot/imir等のtransformative
// propertyにより、decode後の実寸法がispeの宣言寸法と単純一致しないvalid fileがあり得るため、
// AVIFではcreateImageBitmap後にdimensionsRoughlyMatchによるispeとの完全一致は要求せず、
// 代わりにdecode後の実寸法自体をDECODE_SAFETY_LIMITSで再検証する)。

import { detectApng } from "./apng-detection";
import { hasAvisBrand, readAvifIspeCandidates } from "./avif-isobmff";
import { MAX_AVIF_INPUT_BYTES } from "./avif-conversion-types";
import {
  DECODE_SAFETY_LIMITS,
  dimensionsRoughlyMatch,
  validateDeclaredDimensions,
} from "./decode-safety";
import { parseFtypBox } from "./ftyp-detection";
import { readDeclaredDimensions } from "./image-header-dimensions";
import {
  isAllowedRasterQuality,
  isValidRasterBackground,
  isValidRasterSourceFormat,
} from "./raster-convert-types";
import { detectWebpAnimation } from "./webp-animation-detection";
import type { DeclaredDimensions } from "./image-header-dimensions";
import type { RasterBackgroundColor, RasterSourceFormat } from "./raster-convert-types";

declare const self: DedicatedWorkerGlobalScope;

export interface RasterConvertWorkerRequestMessage {
  id: string;
  buffer: ArrayBuffer;
  sourceFormat: RasterSourceFormat;
  /** 0.10〜0.98の範囲を想定。1.0は使用しない(raster-convert-types.ts参照) */
  quality: number;
  background: RasterBackgroundColor;
}

export interface RasterConvertWorkerDoneMessage {
  id: string;
  type: "result";
  status: "done";
  jpegBuffer: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
  elapsedMs: number;
}

/** アニメーションPNG(acTLチャンク)・アニメーションWebP(ANIM/ANMFチャンク等)を検出し、createImageBitmap前に拒否した場合 */
export interface RasterConvertWorkerUnsupportedAnimationMessage {
  id: string;
  type: "result";
  status: "unsupported-animation";
}

/** 入力の構造自体が壊れている/宣言されたsourceFormatと判定できない場合。createImageBitmapは一切呼ばない */
export interface RasterConvertWorkerMalformedMessage {
  id: string;
  type: "result";
  status: "malformed-source";
}

/**
 * デコード前の寸法・ピクセル数安全検証(decode-safety.ts)で拒否された場合。AVIFについては
 * decode前(ispe候補の個別検証)・decode後(実寸法の再検証)のいずれで拒否されても、同じこの
 * statusを返す(呼び出し側にとって「安全に処理できなかった」という意味は同じであるため)。
 */
export interface RasterConvertWorkerUnsafeDimensionsMessage {
  id: string;
  type: "result";
  status: "unsafe-dimensions";
}

/**
 * 圧縮ファイル自体のバイト数がMAX_AVIF_INPUT_BYTESを超える場合。createImageBitmap/
 * readAvifIspeCandidatesを一切呼ばず、buffer.byteLengthだけで即座に拒否する。
 * intake側(use-image-intake.ts)が既にfile.size上限を検証しているため、通常のUIからは
 * 到達しない想定の最終防御(Worker側の安全境界)。
 */
export interface RasterConvertWorkerInputTooLargeMessage {
  id: string;
  type: "result";
  status: "input-too-large";
}

/** createImageBitmap後の実寸法が、ヘッダーの宣言寸法と一致しない場合(EXIF回転相当の入れ替わりは許容) */
export interface RasterConvertWorkerDimensionMismatchMessage {
  id: string;
  type: "result";
  status: "dimension-mismatch";
}

/** convertToBlobへimage/jpegを指定したが、生成されたBlobのtypeがimage/jpegではなかった場合 */
export interface RasterConvertWorkerUnsupportedEncoderMessage {
  id: string;
  type: "result";
  status: "unsupported-encoder";
}

/** デコードまたはエンコードが時間予算を超過した場合 */
export interface RasterConvertWorkerTimeoutMessage {
  id: string;
  type: "result";
  status: "timeout";
}

/**
 * リクエストされたqualityがこのツールで許可する値(0.65/0.80/0.90)以外だった場合。
 * UI(raster-convert-types.ts)から生成される値は常にこの3値のいずれかだが、Worker側が
 * 最終的な安全境界としてcreateImageBitmap前に必ず検証する。
 */
export interface RasterConvertWorkerInvalidQualityMessage {
  id: string;
  type: "result";
  status: "invalid-quality";
}

export interface RasterConvertWorkerErrorMessage {
  id: string;
  type: "result";
  status: "error";
  message: string;
}

export type RasterConvertWorkerResultMessage =
  | RasterConvertWorkerDoneMessage
  | RasterConvertWorkerUnsupportedAnimationMessage
  | RasterConvertWorkerMalformedMessage
  | RasterConvertWorkerUnsafeDimensionsMessage
  | RasterConvertWorkerInputTooLargeMessage
  | RasterConvertWorkerDimensionMismatchMessage
  | RasterConvertWorkerUnsupportedEncoderMessage
  | RasterConvertWorkerTimeoutMessage
  | RasterConvertWorkerInvalidQualityMessage
  | RasterConvertWorkerErrorMessage;

export type RasterConvertOutcome =
  | {
      status: "done";
      jpegBuffer: ArrayBuffer;
      width: number;
      height: number;
      quality: number;
      elapsedMs: number;
    }
  | { status: "dimension-mismatch" }
  /** AVIFのみ: createImageBitmap後の実寸法がDECODE_SAFETY_LIMITSを超える場合(convertRasterBufferToJpeg参照) */
  | { status: "unsafe-dimensions" }
  | { status: "unsupported-encoder" }
  | { status: "timeout" }
  | { status: "error"; message: string };

/** デコード・エンコードそれぞれに許す処理時間の上限(ミリ秒)。極端に巨大な画像で無制限に待たないための安全弁 */
const TIME_BUDGET_MS = 20000;
const JPEG_MIME_TYPE = "image/jpeg";

const SOURCE_MIME_TYPE: Record<RasterSourceFormat, string> = {
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

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
 * PNG/WebP/AVIF BlobをJPEGへ変換する処理本体。self.onmessageから分離しているのは、単体テストで
 * createImageBitmap/OffscreenCanvasをモックしつつこの関数だけを直接検証できるようにするため。
 *
 * JPEGはアルファチャンネルを持たないため、描画前に必ずbackgroundで塗りつぶしたキャンバスへ
 * drawImageする。入力に透明部分が無い場合でも、不透明な画像がその上から描画されるだけで見た目に
 * 影響しないため、常にこの塗りつぶしを行って構わない(透明判定の分岐を持たない、意図的な単純化)。
 *
 * 目標容量探索は行わない(指定容量圧縮とは異なるMVP)。固定のquality値で1回だけエンコードする。
 * 呼び出し前提: 呼び出し側(self.onmessage)が既にアニメーション判定・寸法安全性検証を完了していること。
 *
 * AVIF(declaredDimensionsがnull)の場合、上記の「呼び出し側が寸法検証済み」という前提は
 * decode前のispe候補検証までしか保証しない。clap/irot/imir等のtransformative propertyにより
 * decode後の実寸法がispeの宣言寸法と一致しないvalid fileがあり得るため、AVIFに限り
 * createImageBitmap後にDECODE_SAFETY_LIMITSでの再検証を行う(PNG/WebPはこの再検証を行わない —
 * 既存のdeclaredDimensions照合で十分なため)。
 */
export async function convertRasterBufferToJpeg(
  buffer: ArrayBuffer,
  sourceFormat: RasterSourceFormat,
  quality: number,
  background: RasterBackgroundColor,
  /** ヘッダーから読み取った宣言寸法(省略時は照合を行わない) */
  declaredDimensions?: DeclaredDimensions | null,
  timeBudgetMs: number = TIME_BUDGET_MS,
): Promise<RasterConvertOutcome> {
  const startTime = Date.now();

  let bitmap: ImageBitmap;
  try {
    bitmap = await withTimeout(
      createImageBitmap(new Blob([buffer], { type: SOURCE_MIME_TYPE[sourceFormat] }), {
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

  if (sourceFormat === "avif") {
    const postDecodeSafetyError = validateDeclaredDimensions({ width, height });
    if (postDecodeSafetyError) {
      bitmap.close();
      return { status: "unsafe-dimensions" };
    }
  }

  let blob: Blob;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvasの2Dコンテキストを取得できませんでした");
    ctx.fillStyle = `rgb(${background.r}, ${background.g}, ${background.b})`;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0);
    blob = await withTimeout(canvas.convertToBlob({ type: JPEG_MIME_TYPE, quality }), timeBudgetMs);
  } catch (error) {
    bitmap.close();
    if (error instanceof TimeoutError) return { status: "timeout" };
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  bitmap.close();

  if (blob.type !== JPEG_MIME_TYPE) {
    return { status: "unsupported-encoder" };
  }

  const jpegBuffer = await blob.arrayBuffer();
  return {
    status: "done",
    jpegBuffer,
    width,
    height,
    quality,
    elapsedMs: Date.now() - startTime,
  };
}

self.onmessage = async (event: MessageEvent<RasterConvertWorkerRequestMessage>) => {
  const { id, buffer, sourceFormat, quality, background } = event.data;
  try {
    // decode/encodeを一切開始する前に、リクエストの形そのもの(sourceFormat・background)を
    // 検証する。postMessageで届く値はstructured cloneを通るだけでTypeScriptの型による保証を
    // 受けないため、この検証こそが最終的な安全境界となる。不正な場合はcreateImageBitmap/
    // readDeclaredDimensions等を一切呼ばず、安全にerrorを返す。
    if (!isValidRasterSourceFormat(sourceFormat)) {
      const message: RasterConvertWorkerErrorMessage = {
        id,
        type: "result",
        status: "error",
        message: `不正なsourceFormatです: ${String(sourceFormat)}`,
      };
      self.postMessage(message);
      return;
    }
    if (!isValidRasterBackground(background)) {
      const message: RasterConvertWorkerErrorMessage = {
        id,
        type: "result",
        status: "error",
        message: "不正な背景色です(r/g/bは0〜255の整数である必要があります)",
      };
      self.postMessage(message);
      return;
    }

    // createImageBitmap(decode)前に、まずqualityがこのツールで許可する値かを検証する。
    // UI(raster-convert-types.ts)は常に許可された値のみを送るはずだが、Worker側のこの検証こそが
    // 最終的な安全境界であり、不正なqualityがconvertToBlobへ渡ることを防ぐ。
    if (!isAllowedRasterQuality(quality)) {
      const message: RasterConvertWorkerInvalidQualityMessage = {
        id,
        type: "result",
        status: "invalid-quality",
      };
      self.postMessage(message);
      return;
    }

    // AVIFのみ: pre-decode safety(ispe候補の検証)のためbuffer全体をavif-isobmff.tsへ渡すことになる。
    // その読み込み自体が先にメモリを圧迫しないよう、parse/createImageBitmapより前に
    // 圧縮ファイル自体のバイト数を検証する(intake側use-image-intake.tsのfile.sizeチェックと
    // 同じ理由の、Worker側での最終防御)。PNG/WebPにはこの入口制限を設けない
    // (既存の安全性検証を変更しないという方針を優先する)。
    if (sourceFormat === "avif" && buffer.byteLength > MAX_AVIF_INPUT_BYTES) {
      const message: RasterConvertWorkerInputTooLargeMessage = {
        id,
        type: "result",
        status: "input-too-large",
      };
      self.postMessage(message);
      return;
    }

    const bytes = new Uint8Array(buffer);

    // createImageBitmap(decode)前に、まずアニメーション判定を行う。Worker側のこの判定こそが
    // 最終的な安全境界であり、フック側(use-raster-to-jpg.ts)の事前チェックはUIを早く
    // 更新するためのものに過ぎない(そちらを迂回・すり抜けても、ここで必ずアニメーション
    // 画像をcreateImageBitmapへ渡さない)。判定関数はsourceFormatごとに異なる(PNGはacTL、
    // WebPはVP8X ANIMフラグ/ANIM・ANMFチャンク、AVIFはftypのcompatible_brandsにavisが
    // 含まれるか)。
    if (sourceFormat === "avif") {
      const ftyp = parseFtypBox(bytes);
      if (!ftyp) {
        const message: RasterConvertWorkerMalformedMessage = {
          id,
          type: "result",
          status: "malformed-source",
        };
        self.postMessage(message);
        return;
      }
      if (hasAvisBrand([ftyp.majorBrand, ...ftyp.compatibleBrands])) {
        const message: RasterConvertWorkerUnsupportedAnimationMessage = {
          id,
          type: "result",
          status: "unsupported-animation",
        };
        self.postMessage(message);
        return;
      }
    } else {
      const animationCheck =
        sourceFormat === "png" ? detectApng(bytes) : detectWebpAnimation(bytes);
      if (animationCheck === "animated") {
        const message: RasterConvertWorkerUnsupportedAnimationMessage = {
          id,
          type: "result",
          status: "unsupported-animation",
        };
        self.postMessage(message);
        return;
      }
      if (
        animationCheck === "malformed" ||
        animationCheck === "not-png" ||
        animationCheck === "not-webp"
      ) {
        const message: RasterConvertWorkerMalformedMessage = {
          id,
          type: "result",
          status: "malformed-source",
        };
        self.postMessage(message);
        return;
      }
    }

    // createImageBitmap(decode)前に、ヘッダーだけから宣言寸法を読み取り安全性を検証する。
    // ここで拒否された画像はcreateImageBitmapへ一切渡さない。
    //
    // AVIFはPNG/WebPと形が異なる: 単一のDeclaredDimensionsではなく、avif-isobmff.tsが返す
    // ispe候補の配列を個別に検証する(use-image-intake.tsのanalyze()と同じ設計判断 — 複数candidateの
    // width/heightの最大値同士を合成すると、実在しない寸法を作ってしまうため)。0件、または
    // 1件でも安全上限を超える候補があれば安全側で拒否する。declaredDimensionsはnullのまま
    // convertRasterBufferToJpegへ渡し(後述のcreateImageBitmap後の再検証で守るため)、
    // 既存のdimensionsRoughlyMatchによる完全一致は要求しない。
    let declaredDimensions: DeclaredDimensions | null = null;
    if (sourceFormat === "avif") {
      const candidates = readAvifIspeCandidates(bytes);
      const hasUnsafeCandidate =
        candidates.length === 0 ||
        candidates.some((candidate) => validateDeclaredDimensions(candidate, DECODE_SAFETY_LIMITS));
      if (hasUnsafeCandidate) {
        const message: RasterConvertWorkerUnsafeDimensionsMessage = {
          id,
          type: "result",
          status: "unsafe-dimensions",
        };
        self.postMessage(message);
        return;
      }
    } else {
      declaredDimensions = readDeclaredDimensions(bytes, sourceFormat);
      const safetyError = validateDeclaredDimensions(declaredDimensions, DECODE_SAFETY_LIMITS);
      if (safetyError) {
        const message: RasterConvertWorkerUnsafeDimensionsMessage = {
          id,
          type: "result",
          status: "unsafe-dimensions",
        };
        self.postMessage(message);
        return;
      }
    }

    const outcome = await convertRasterBufferToJpeg(
      buffer,
      sourceFormat,
      quality,
      background,
      declaredDimensions,
    );

    if (outcome.status === "done") {
      const message: RasterConvertWorkerDoneMessage = {
        id,
        type: "result",
        status: "done",
        jpegBuffer: outcome.jpegBuffer,
        width: outcome.width,
        height: outcome.height,
        quality: outcome.quality,
        elapsedMs: outcome.elapsedMs,
      };
      self.postMessage(message, [outcome.jpegBuffer]);
      return;
    }
    if (outcome.status === "dimension-mismatch") {
      const message: RasterConvertWorkerDimensionMismatchMessage = {
        id,
        type: "result",
        status: "dimension-mismatch",
      };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "unsafe-dimensions") {
      // AVIFのみ到達しうる: createImageBitmap後の実寸法がDECODE_SAFETY_LIMITSを超えていた場合
      // (convertRasterBufferToJpeg参照)。decode前のispe候補検証で既に拒否済みのケースと同じ
      // statusで返す(呼び出し側にとって意味は同じであるため)。
      const message: RasterConvertWorkerUnsafeDimensionsMessage = {
        id,
        type: "result",
        status: "unsafe-dimensions",
      };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "unsupported-encoder") {
      const message: RasterConvertWorkerUnsupportedEncoderMessage = {
        id,
        type: "result",
        status: "unsupported-encoder",
      };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "timeout") {
      const message: RasterConvertWorkerTimeoutMessage = { id, type: "result", status: "timeout" };
      self.postMessage(message);
      return;
    }
    const message: RasterConvertWorkerErrorMessage = {
      id,
      type: "result",
      status: "error",
      message: outcome.message,
    };
    self.postMessage(message);
  } catch (error) {
    const message: RasterConvertWorkerErrorMessage = {
      id,
      type: "result",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(message);
  }
};
