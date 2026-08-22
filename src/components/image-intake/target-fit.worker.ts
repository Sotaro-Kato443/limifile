/// <reference lib="webworker" />
// 指定した幅×高さへ厳密に合わせ、JPEG容量上限を満たすよう変換する汎用Worker。
// "signature"等の用途固有概念は一切含まない(target-fit-types.ts参照)。
//
// 既存の圧縮系Worker(image-compress.worker.ts等)と異なり、寸法を自由変数として使わない。
// 寸法(targetWidth×targetHeight)は最初に確定し、以後変更しない — 外部提出条件としての
// 絶対要件であるため。自由変数はJPEG qualityのみであり、探索対象がcanvasの描画内容ではなく
// エンコードのみであるため、canvasは1回だけ描画し、以後はconvertToBlobをqualityを変えて
// 複数回呼ぶ(raster-convert.worker.ts/image-compress.worker.tsのように寸法が変わるたびに
// 再描画する必要が無いため、この点はそれらより単純)。
//
// JPEG qualityはencoder内部の実装により必ずしもbytesに対して単調ではない
// (image-compress.worker.tsの既存コメントと同じ前提)。そのため:
// - bestFit: maxBytes以下になった実測候補の中でqualityが最大のもの(=見た目最良)
// - smallestSeen: 全実測候補の中でbytesが最小のもの(bestFitが無い場合のfallback)
// を独立に追跡する。floor quality(qualityRange[0])は二分探索の収束に依存せず必ず1回
// probeする — 「最悪の場合の候補」を確実に持つため(bestFitが無くてもsmallestSeenは
// 必ず存在することを保証する)。続けてqualityHi(qualityRange[1]、v1で許可する最高品質)も
// 直接probeする — これがmaxBytes以下ならそれ自体がこの範囲内で最良の結果であり、
// それより高いqualityは存在しないため二分探索を行う必要が無い(レビューで指摘: 従来は
// qualityHiそのものを一度もencodeしておらず、余裕がある画像でも二分探索の中間値止まりに
// なっていた)。
//
// convertToBlobが実際に返したBlob.typeがimage/jpegでなければ、encodeAt()自身がその場で
// UnsupportedEncoderErrorを投げる(floor/qualityHi/二分探索のどのprobeでも同様)。これにより
// JPEG以外のblob.sizeがbestFit/smallestSeenの追跡はもちろん、二分探索のlo/hi判定へも
// 一切使われない(レビューで指摘: 従来はfloor probe以外がJPEG以外を返した場合、
// bestFit/smallestSeenからは除外されていてもそのbytesがbinary searchのlo/hi更新に
// 使われてしまっていた)。
//
// 最終的にwinner(bestFitまたはsmallestSeen)を選んだ後、そのblob.arrayBuffer()で得た
// 実バイト列からreadDeclaredDimensions(header再parse)を行い、その結果をcandidate.width/
// heightとして使う(レビューで指摘: 「canvasをtargetWidth×targetHeightで作った」ことを
// 「出力もその寸法だった」の証明にせず、変換後ファイルそのものを独立して検証する)。
// 再parseできない場合は正常な結果として返さない。
//
// done/unreachableの最終判定も、この再parse結果(MIME・width・height)とjpegBuffer.byteLength
// (実測bytes)から独立に決める。bestFitが存在するかどうかという探索途中の分類だけに頼らない
// (レビューで指摘: bestFitがあるというだけでdoneにすると、実測headerがtargetと食い違って
// いてもdoneになり得た。UI上部の「全条件を満たした」という文言と、buildConditionChecklistが
// 生成するchecklistのNot met表示が矛盾してしまう)。width/height/MIMEのいずれかが不一致なら
// 既存のunsupported-encoderへ倒す。一致する場合のみ実測bytes<=maxBytesでdone/unreachableを
// 分ける。

import { detectApng } from "./apng-detection";
import {
  DECODE_SAFETY_LIMITS,
  validateDeclaredDimensions,
  type DecodeSafetyLimits,
} from "./decode-safety";
import { readDeclaredDimensions, type DeclaredDimensions } from "./image-header-dimensions";
import { isValidRasterBackground } from "./raster-convert-types";
import { computeTargetFitLayout } from "./target-fit-geometry";
import {
  DEFAULT_TARGET_FIT_LIMITS,
  MAX_TARGET_FIT_INPUT_BYTES,
  type FitMode,
  type TargetFitCandidate,
  type TargetFitLimits,
  type TargetFitOutcome,
  type TargetFitSourceFormat,
} from "./target-fit-types";
import type { RasterBackgroundColor } from "./raster-convert-types";

declare const self: DedicatedWorkerGlobalScope;

export type { TargetFitSourceFormat };

export interface TargetFitWorkerRequestMessage {
  id: string;
  buffer: ArrayBuffer;
  sourceFormat: TargetFitSourceFormat;
  targetWidth: number;
  targetHeight: number;
  maxBytes: number;
  fitMode: FitMode;
  background: RasterBackgroundColor;
}

export type TargetFitWorkerResultMessage =
  | {
      id: string;
      type: "result";
      status: "done";
      candidate: TargetFitCandidate;
      encodeCount: number;
      elapsedMs: number;
    }
  | {
      id: string;
      type: "result";
      status: "unreachable";
      bestCandidate: TargetFitCandidate;
      encodeCount: number;
      elapsedMs: number;
    }
  | { id: string; type: "result"; status: "unsupported-animation" }
  | { id: string; type: "result"; status: "unsafe-dimensions" }
  | { id: string; type: "result"; status: "invalid-request" }
  | { id: string; type: "result"; status: "unsupported-encoder" }
  | { id: string; type: "result"; status: "timeout" }
  | { id: string; type: "result"; status: "error"; message: string };

const JPEG_MIME_TYPE = "image/jpeg";
const SOURCE_MIME_TYPE: Record<TargetFitSourceFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
};

class TimeoutError extends Error {
  constructor() {
    super("処理が時間予算を超過しました");
    this.name = "TimeoutError";
  }
}

/**
 * convertToBlobがimage/jpeg以外のBlob.typeを返した場合に投げる。floor/qualityHi/二分探索の
 * どのprobeであってもここで即座に中断し、そのblob.sizeを容量探索(lo/hiの更新)へ一切使わせない
 * (レビューで指摘: floor probe以外がJPEG以外を返した場合、そのbytesがbinary searchの
 * 判断に使われてしまっていた)。
 */
class UnsupportedEncoderError extends Error {
  constructor() {
    super("convertToBlobがimage/jpeg以外を返しました");
    this.name = "UnsupportedEncoderError";
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
 * リクエストの形そのものを検証する。postMessageで届く値はTypeScriptの型による保証を
 * 受けないため、この検証こそが最終的な安全境界となる。
 *
 * 不正な値をclamp(丸め込み)して処理を続けることは意図的に行わない — ユーザーが入力した
 * 条件と実際に処理した条件が食い違ってしまうため(レビューで明示された方針)。
 * targetWidth/targetHeightはvalidateDeclaredDimensions(source画像の寸法検証と同じ関数)を
 * そのまま再利用し、integer/positive/maxDimension/maxPixelsを検証する。
 */
function validateRequest(
  data: TargetFitWorkerRequestMessage,
  limits: DecodeSafetyLimits,
): string | null {
  if (typeof data.id !== "string" || data.id.length === 0) return "invalid id";
  if (!(data.buffer instanceof ArrayBuffer)) return "invalid buffer";
  if (data.buffer.byteLength <= 0 || data.buffer.byteLength > MAX_TARGET_FIT_INPUT_BYTES) {
    return "invalid buffer size";
  }
  if (data.sourceFormat !== "jpeg" && data.sourceFormat !== "png") {
    return `invalid sourceFormat: ${String(data.sourceFormat)}`;
  }
  const dimensionsError = validateDeclaredDimensions(
    { width: data.targetWidth, height: data.targetHeight },
    limits,
  );
  if (dimensionsError) return `invalid target dimensions: ${dimensionsError}`;
  if (!Number.isFinite(data.maxBytes) || data.maxBytes <= 0) return "invalid maxBytes";
  if (data.fitMode !== "contain" && data.fitMode !== "stretch") {
    return `invalid fitMode: ${String(data.fitMode)}`;
  }
  if (!isValidRasterBackground(data.background)) return "invalid background";
  return null;
}

interface EncodeAttempt {
  quality: number;
  bytes: number;
  blob: Blob;
}

/**
 * attemptがqualityと一致するかを判定する。関数境界を挟むことで、呼び出し元スコープの
 * try/catch内の複合条件(`!bestFit && !smallestSeen`)によるTypeScriptの制御フロー解析の
 * 過剰な狭め込み(bestFitがnull型だけに絞られてしまう既知の挙動)を避ける
 * (finalizeOutcomeを別関数に分離したのと同じ理由)。
 */
function matchesQuality(attempt: EncodeAttempt | null, quality: number): boolean {
  return attempt !== null && attempt.quality === quality;
}

/**
 * targetFitBufferToJpeg自身が実際に返しうる結果。呼び出し前提(アニメーション判定・リクエスト
 *検証は呼び出し側が完了済み)により、TargetFitOutcomeのうち"unsupported-animation"・
 * "invalid-request"は返さない。self.onmessage側の網羅チェックが正しく機能するよう、
 * 戻り値の型自体でこれを表現する。
 */
type TargetFitComputeOutcome = Exclude<
  TargetFitOutcome,
  { status: "unsupported-animation" } | { status: "invalid-request" }
>;

/**
 * targetWidth×targetHeightのcanvasへ1回だけ描画し、qualityを変えながらconvertToBlobを
 * 繰り返す処理本体。self.onmessageから分離しているのは、単体テストでcreateImageBitmap/
 * OffscreenCanvasをモックしつつこの関数だけを直接検証できるようにするため
 * (raster-convert.worker.tsのconvertRasterBufferToJpegと同じ設計)。
 *
 * 呼び出し前提: 呼び出し側(self.onmessage)が既にリクエスト検証・アニメーション判定・
 * source側の寸法安全性検証を完了していること。
 */
export async function targetFitBufferToJpeg(
  buffer: ArrayBuffer,
  sourceFormat: TargetFitSourceFormat,
  request: {
    targetWidth: number;
    targetHeight: number;
    maxBytes: number;
    fitMode: FitMode;
    background: RasterBackgroundColor;
  },
  limits: TargetFitLimits = DEFAULT_TARGET_FIT_LIMITS,
): Promise<TargetFitComputeOutcome> {
  const startTime = Date.now();
  const { targetWidth, targetHeight, maxBytes, fitMode, background } = request;

  let bitmap: ImageBitmap;
  try {
    bitmap = await withTimeout(
      createImageBitmap(new Blob([buffer], { type: SOURCE_MIME_TYPE[sourceFormat] }), {
        imageOrientation: "from-image",
      }),
      limits.timeBudgetMs,
    );
  } catch (error) {
    if (error instanceof TimeoutError) return { status: "timeout" };
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  // decode後の実寸法を、宣言寸法とは独立に再検証する(ヘッダーが実際より小さい寸法を
  // 宣言していた場合の最終防御)。target-fitは常にtargetWidth×targetHeightへ描画するため、
  // raster-convert.worker.tsのdimensionsRoughlyMatchのような「宣言寸法と実寸法の完全一致」は
  // 要求しない(resizeが前提のツールのため、一致していなくても処理自体は安全に行える)。
  const postDecodeSafetyError = validateDeclaredDimensions({
    width: bitmap.width,
    height: bitmap.height,
  });
  if (postDecodeSafetyError) {
    bitmap.close();
    return { status: "unsafe-dimensions" };
  }

  const layout = computeTargetFitLayout(
    fitMode,
    bitmap.width,
    bitmap.height,
    targetWidth,
    targetHeight,
  );

  let canvas: OffscreenCanvas;
  let ctx: OffscreenCanvasRenderingContext2D;
  try {
    canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("OffscreenCanvasの2Dコンテキストを取得できませんでした");
    ctx = context;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = `rgb(${background.r}, ${background.g}, ${background.b})`;
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(bitmap, layout.dx, layout.dy, layout.drawWidth, layout.drawHeight);
  } catch (error) {
    bitmap.close();
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
  bitmap.close();

  let encodeCount = 0;
  let bestFit: EncodeAttempt | null = null;
  let smallestSeen: EncodeAttempt | null = null;

  const budgetExhausted = () => Date.now() - startTime > limits.timeBudgetMs;

  const encodeAt = async (quality: number): Promise<Blob> => {
    encodeCount++;
    const blob = await withTimeout(
      canvas.convertToBlob({ type: JPEG_MIME_TYPE, quality }),
      limits.timeBudgetMs,
    );
    // blob.typeがimage/jpeg以外であれば、このprobeのbytesを容量探索へ一切使わせないよう
    // ここで即座に投げる(floor/qualityHi/二分探索のどのprobeでも同様)。
    if (blob.type !== JPEG_MIME_TYPE) {
      throw new UnsupportedEncoderError();
    }
    const attempt: EncodeAttempt = { quality, bytes: blob.size, blob };
    if (!smallestSeen || attempt.bytes < smallestSeen.bytes) smallestSeen = attempt;
    if (attempt.bytes <= maxBytes && (!bestFit || attempt.quality > bestFit.quality)) {
      bestFit = attempt;
    }
    return blob;
  };

  const [qualityLo, qualityHi] = limits.qualityRange;

  try {
    // floor probeは二分探索の収束に依存せず、必ず「最悪の場合の候補」を1件確保する。
    // convertToBlobの実際のエンコーダをここで確認し、想定外のtype(image/jpeg以外)であれば
    // 以降の反復を無駄にせず即座にunsupported-encoderとして打ち切る(encodeAt内でthrow)。
    await encodeAt(qualityLo);
  } catch (error) {
    if (error instanceof TimeoutError) return { status: "timeout" };
    if (error instanceof UnsupportedEncoderError) return { status: "unsupported-encoder" };
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  // qualityHi(v1で許可する最高品質)を直接probeする。これがmaxBytes以下ならそれ自体が
  // 最良の結果であり、それより高いqualityは範囲内に存在しないため二分探索は行わない。
  try {
    await encodeAt(qualityHi);
  } catch (error) {
    if (error instanceof TimeoutError) {
      if (!bestFit && !smallestSeen) return { status: "timeout" };
    } else if (error instanceof UnsupportedEncoderError) {
      return { status: "unsupported-encoder" };
    } else {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  const hiAlreadyFits = matchesQuality(bestFit, qualityHi);
  if (!hiAlreadyFits) {
    let lo = qualityLo;
    let hi = qualityHi;
    try {
      for (let i = 0; i < limits.maxQualityIterations && !budgetExhausted(); i++) {
        const quality = (lo + hi) / 2;
        const blob = await encodeAt(quality);
        if (blob.size <= maxBytes) {
          lo = quality;
        } else {
          hi = quality;
        }
      }
    } catch (error) {
      if (error instanceof TimeoutError) {
        // 既に得ている候補があれば、時間予算超過はエラーではなくその時点の最良結果として扱う
        if (!bestFit && !smallestSeen) return { status: "timeout" };
      } else if (error instanceof UnsupportedEncoderError) {
        return { status: "unsupported-encoder" };
      } else {
        return {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const elapsedMs = Date.now() - startTime;

  return finalizeOutcome(
    bestFit,
    smallestSeen,
    layout.upscaled,
    encodeCount,
    elapsedMs,
    targetWidth,
    targetHeight,
    maxBytes,
  );
}

/**
 * bestFit/smallestSeenの2状態からTargetFitComputeOutcomeを組み立てる。targetFitBufferToJpeg
 * 本体から分離しているのは、bestFit/smallestSeenをこの関数自身の引数(呼び出し元スコープの
 * 制御フロー解析から独立した束縛)として受け取ることで、TypeScriptのnarrowingに頼らず
 * 素直にnullチェックできるようにするため。
 *
 * candidate.width/heightは、canvasをtargetWidth×targetHeightで作ったことをそのまま
 * 転記するのではなく、winnerの実バイト列(jpegBuffer)からreadDeclaredDimensionsで
 * 再parseした値を使う — 「canvasをtargetWidth×targetHeightで作った」ことと「出力ファイルが
 * 実際にその寸法だった」ことは別の事実であり、verification layer(buildConditionChecklist)は
 * 後者を独立して検証できなければならない(レビューで指摘)。再parseできない場合は
 * (エンコーダの異常な出力等)正常な結果として返さない。
 *
 * done/unreachableの最終判定も、bestFit(探索途中の分類)ではなく、ここで再検証した実測値
 * から独立に決める(レビューで指摘: bestFitが存在するというだけでdoneにすると、実測header
 * がtargetと食い違っていてもdoneになり、UI上の「全条件を満たした」という文言とchecklistの
 * Not met表示が矛盾してしまう)。
 * - MIME(image/jpeg)・width・heightがtargetと一致しない場合は、doneでもunreachableでもなく
 *   既存のunsupported-encoder(UI文言: generated JPEGを安全に検証できなかった)へ倒す。
 * - 一致する場合のみ、実測bytes(jpegBuffer.byteLength)がmaxBytes以下かどうかでdone/unreachable
 *   を決める(bestFitの有無という探索上の分類には依存しない)。
 */
async function finalizeOutcome(
  bestFit: EncodeAttempt | null,
  smallestSeen: EncodeAttempt | null,
  upscaled: boolean,
  encodeCount: number,
  elapsedMs: number,
  targetWidth: number,
  targetHeight: number,
  maxBytes: number,
): Promise<TargetFitComputeOutcome> {
  const winner = bestFit ?? smallestSeen;
  // floor probeが必ず1回成功しているため、winnerはこの時点で必ず存在するはずだが、
  // 万一の場合も安全側でerrorとして扱う。
  if (!winner) {
    return { status: "error", message: "no encode attempt was recorded" };
  }

  const jpegBuffer = await winner.blob.arrayBuffer();
  const declared = readDeclaredDimensions(new Uint8Array(jpegBuffer), "jpeg");
  if (!declared) {
    return { status: "error", message: "output JPEG dimensions could not be verified" };
  }

  const candidate: TargetFitCandidate = {
    jpegBuffer,
    width: declared.width,
    height: declared.height,
    quality: winner.quality,
    bytes: jpegBuffer.byteLength,
    mimeType: winner.blob.type,
    upscaled,
  };

  const outputVerified =
    candidate.mimeType === JPEG_MIME_TYPE &&
    candidate.width === targetWidth &&
    candidate.height === targetHeight;
  if (!outputVerified) {
    return { status: "unsupported-encoder" };
  }

  if (candidate.bytes <= maxBytes) {
    return { status: "done", candidate, encodeCount, elapsedMs };
  }
  return { status: "unreachable", bestCandidate: candidate, encodeCount, elapsedMs };
}

self.onmessage = async (event: MessageEvent<TargetFitWorkerRequestMessage>) => {
  const data = event.data;
  const { id } = data;
  try {
    const validationError = validateRequest(data, DECODE_SAFETY_LIMITS);
    if (validationError) {
      const message: TargetFitWorkerResultMessage = {
        id,
        type: "result",
        status: "invalid-request",
      };
      self.postMessage(message);
      return;
    }

    const { buffer, sourceFormat, targetWidth, targetHeight, maxBytes, fitMode, background } = data;
    const bytes = new Uint8Array(buffer);

    // createImageBitmap(decode)前に、まずアニメーション判定を行う(PNGのみ。JPEGにアニメーションの
    // 概念は無い)。raster-convert.worker.tsと同じく、Worker側のこの判定が最終的な安全境界。
    if (sourceFormat === "png") {
      const animationCheck = detectApng(bytes);
      if (animationCheck === "animated") {
        const message: TargetFitWorkerResultMessage = {
          id,
          type: "result",
          status: "unsupported-animation",
        };
        self.postMessage(message);
        return;
      }
      if (animationCheck === "malformed" || animationCheck === "not-png") {
        const message: TargetFitWorkerResultMessage = {
          id,
          type: "result",
          status: "unsafe-dimensions",
        };
        self.postMessage(message);
        return;
      }
    }

    // createImageBitmap(decode)前に、ヘッダーだけから宣言寸法を読み取り安全性を検証する。
    const declaredDimensions: DeclaredDimensions | null = readDeclaredDimensions(
      bytes,
      sourceFormat,
    );
    const safetyError = validateDeclaredDimensions(declaredDimensions, DECODE_SAFETY_LIMITS);
    if (safetyError) {
      const message: TargetFitWorkerResultMessage = {
        id,
        type: "result",
        status: "unsafe-dimensions",
      };
      self.postMessage(message);
      return;
    }

    const outcome = await targetFitBufferToJpeg(buffer, sourceFormat, {
      targetWidth,
      targetHeight,
      maxBytes,
      fitMode,
      background,
    });

    if (outcome.status === "done") {
      const message: TargetFitWorkerResultMessage = {
        id,
        type: "result",
        status: "done",
        candidate: outcome.candidate,
        encodeCount: outcome.encodeCount,
        elapsedMs: outcome.elapsedMs,
      };
      self.postMessage(message, [outcome.candidate.jpegBuffer]);
      return;
    }
    if (outcome.status === "unreachable") {
      const message: TargetFitWorkerResultMessage = {
        id,
        type: "result",
        status: "unreachable",
        bestCandidate: outcome.bestCandidate,
        encodeCount: outcome.encodeCount,
        elapsedMs: outcome.elapsedMs,
      };
      self.postMessage(message, [outcome.bestCandidate.jpegBuffer]);
      return;
    }
    if (outcome.status === "unsafe-dimensions") {
      const message: TargetFitWorkerResultMessage = {
        id,
        type: "result",
        status: "unsafe-dimensions",
      };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "unsupported-encoder") {
      const message: TargetFitWorkerResultMessage = {
        id,
        type: "result",
        status: "unsupported-encoder",
      };
      self.postMessage(message);
      return;
    }
    if (outcome.status === "timeout") {
      const message: TargetFitWorkerResultMessage = { id, type: "result", status: "timeout" };
      self.postMessage(message);
      return;
    }
    const message: TargetFitWorkerResultMessage = {
      id,
      type: "result",
      status: "error",
      message: outcome.message,
    };
    self.postMessage(message);
  } catch (error) {
    const message: TargetFitWorkerResultMessage = {
      id,
      type: "result",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(message);
  }
};
