/// <reference lib="webworker" />
// PNG指定容量圧縮は必ずこのDedicated Worker内で実行する。メインスレッドでは呼び出さない。

import { detectApng } from "../image-intake/apng-detection";
import { DECODE_SAFETY_LIMITS, validateDeclaredDimensions } from "../image-intake/decode-safety";
import { readDeclaredDimensions } from "../image-intake/image-header-dimensions";
import {
  DEFAULT_PNG_COMPRESSION_LIMITS,
  isValidTargetBytes,
  PNG_MIME_TYPE,
  type PngCompressionOutcome,
  type UpngEncodeFunction,
} from "./png-compression-types";
import { runPngCompressionSearch, type PngCompressionSearchDeps } from "./png-compression-engine";
import { getRgbaAtSize, loadUpngEncode } from "./png-compression-upng-loader";
import { verifyPngDecodable } from "./png-compression-decode-verify";
import { TimeoutError, withTimeout } from "./png-compression-timeout";

declare const self: DedicatedWorkerGlobalScope;

export interface PngCompressionWorkerRequestMessage {
  id: string;
  buffer: ArrayBuffer;
  targetBytes: number;
}

export interface PngCompressionWorkerResultMessage {
  id: string;
  type: "result";
  outcome: PngCompressionOutcome;
}

/**
 * 最終的にWorkerから返すPNG(doneのpngBuffer、またはunreachableのbestCandidate.pngBuffer)
 * だけを、createImageBitmapで再デコードして検証する。探索中の全candidateはstrict PNG parser
 * (png-compression-engine.tsのvalidateUpngOutputBytes)のみで検証しており、パフォーマンスのため
 * 実デコードは最終的な1件だけに限定する。
 */
async function verifyFinalOutput(
  pngBuffer: ArrayBuffer,
  expectedWidth: number,
  expectedHeight: number,
  remainingMs: number,
): Promise<"ok" | "timeout" | "invalid"> {
  const verification = await verifyPngDecodable(
    pngBuffer,
    expectedWidth,
    expectedHeight,
    remainingMs,
    true,
  );
  if (verification.status === "timeout") return "timeout";
  if (verification.status === "ok") {
    verification.bitmap.close();
    return "ok";
  }
  return "invalid";
}

self.onmessage = async (event: MessageEvent<PngCompressionWorkerRequestMessage>) => {
  const { id, buffer, targetBytes } = event.data;
  // Worker全体で単一のdeadlineを共有する。targetBytes検証・入力デコード・UPNGロード・探索・
  // 最終出力再デコードの全工程が、この1つのdeadlineから残り時間を都度計算して使う
  // (各工程に個別のtime budgetを新たに割り当てない)。
  const deadline = Date.now() + DEFAULT_PNG_COMPRESSION_LIMITS.workerTimeBudgetMs;

  const respond = (outcome: PngCompressionOutcome): void => {
    const message: PngCompressionWorkerResultMessage = { id, type: "result", outcome };
    if (outcome.status === "done") {
      self.postMessage(message, [outcome.pngBuffer]);
      return;
    }
    if (outcome.status === "unreachable" && outcome.bestCandidate) {
      self.postMessage(message, [outcome.bestCandidate.pngBuffer]);
      return;
    }
    self.postMessage(message);
  };

  try {
    // PNG解析・createImageBitmap・UPNG importより前に、targetBytes自体の実行時安全性を検証する。
    // postMessage経由の値は型注釈だけでは守れない(0・負数・非整数・NaN・Infinity・文字列等)ため、
    // ここが最終的な安全境界になる。
    if (!isValidTargetBytes(targetBytes)) {
      return respond({ status: "invalid-target" });
    }

    const bytes = new Uint8Array(buffer);

    // UPNGを一切呼ぶ前に、既存のstrict PNG parser経由でAPNG判定・構造検証を行う。
    // detectApngは内部でreadPngChunks(signature/IHDR先頭/IHDR length=13/重複IHDR拒否/
    // IEND必須・length 0・IEND後データなし等)を実行するため、ここが最終的な安全境界になる。
    const apngCheck = detectApng(bytes);
    if (apngCheck === "animated") return respond({ status: "animated-png" });
    if (apngCheck === "malformed" || apngCheck === "not-png") {
      return respond({ status: "invalid-png" });
    }

    // createImageBitmap(実デコード)前に、ヘッダーだけから宣言寸法を読み取り安全性を検証する。
    const declaredDimensions = readDeclaredDimensions(bytes, "png");
    const safetyError = validateDeclaredDimensions(declaredDimensions, DECODE_SAFETY_LIMITS);
    if (safetyError || !declaredDimensions) {
      return respond({ status: "unsafe-dimensions" });
    }

    // 入力PNGを必ず一度、実際にcreateImageBitmapでデコードして検証する(元ファイルを
    // そのまま返す経路であっても、ブラウザが実際に開けることの確認だけは省略しない)。
    // strict parserは構造上の妥当性のみを見ており、ブラウザのPNGデコーダが実際に開けるとは
    // 限らないため、ここが真の安全境界になる。
    const remainingForInputDecode = deadline - Date.now();
    const inputVerification = await verifyPngDecodable(
      buffer,
      declaredDimensions.width,
      declaredDimensions.height,
      remainingForInputDecode,
    );
    if (inputVerification.status === "timeout") return respond({ status: "timeout" });
    if (inputVerification.status !== "ok") {
      // decode-failed / dimension-mismatch / unsafe-dimensionsのいずれも、
      // 入力を安全に処理できないという意味でinvalid-pngとして扱う(元ファイルを成功として返さない)。
      return respond({ status: "invalid-png" });
    }
    const inputBitmap = inputVerification.bitmap;

    // 入力が既にtargetBytes以下の場合は、再エンコードせず元ファイルをそのまま返す。
    // 上記のデコード確認結果を再利用し、同じBufferを2回デコードしない。UPNGの読み込みも行わない
    // ため、色数削減・寸法変更・メタデータ変化は発生しない。
    if (buffer.byteLength <= targetBytes) {
      inputBitmap.close();
      return respond({
        status: "done",
        pngBuffer: buffer,
        pngType: PNG_MIME_TYPE,
        originalBytes: buffer.byteLength,
        outputBytes: buffer.byteLength,
        originalWidth: declaredDimensions.width,
        originalHeight: declaredDimensions.height,
        outputWidth: declaredDimensions.width,
        outputHeight: declaredDimensions.height,
        colorCount: null,
        encodeCount: 0,
        originalReturned: true,
      });
    }

    // ここまで来て初めてUPNGを読み込む(PNG処理を実際に開始するタイミングまで遅延)。
    const remainingBeforeUpngLoad = deadline - Date.now();
    if (remainingBeforeUpngLoad <= 0) {
      inputBitmap.close();
      return respond({ status: "timeout" });
    }

    let encode: UpngEncodeFunction;
    try {
      encode = await withTimeout(loadUpngEncode(), remainingBeforeUpngLoad);
    } catch (error) {
      inputBitmap.close();
      if (error instanceof TimeoutError) return respond({ status: "timeout" });
      return respond({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const width = inputBitmap.width;
    const height = inputBitmap.height;

    let originalRgba: ArrayBuffer;
    try {
      originalRgba = getRgbaAtSize(inputBitmap, width, height);
    } catch (error) {
      inputBitmap.close();
      return respond({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const remainingForSearch = deadline - Date.now();
    if (remainingForSearch <= 0) {
      inputBitmap.close();
      return respond({ status: "timeout" });
    }

    const deps: PngCompressionSearchDeps = {
      encode,
      getRgbaAtSize: (w, h) => getRgbaAtSize(inputBitmap, w, h),
    };

    let searchOutcome;
    try {
      searchOutcome = runPngCompressionSearch(deps, originalRgba, width, height, targetBytes, {
        ...DEFAULT_PNG_COMPRESSION_LIMITS,
        workerTimeBudgetMs: remainingForSearch,
      });
    } finally {
      inputBitmap.close();
    }

    if (searchOutcome.status === "done") {
      const remainingForFinalDecode = deadline - Date.now();
      const verify = await verifyFinalOutput(
        searchOutcome.pngBuffer,
        searchOutcome.outputWidth,
        searchOutcome.outputHeight,
        remainingForFinalDecode,
      );
      if (verify === "timeout") return respond({ status: "timeout" });
      if (verify === "invalid") return respond({ status: "unsupported-png-encoder" });
      return respond({
        status: "done",
        pngBuffer: searchOutcome.pngBuffer,
        pngType: PNG_MIME_TYPE,
        originalBytes: buffer.byteLength,
        outputBytes: searchOutcome.outputBytes,
        originalWidth: width,
        originalHeight: height,
        outputWidth: searchOutcome.outputWidth,
        outputHeight: searchOutcome.outputHeight,
        colorCount: searchOutcome.colorCount,
        encodeCount: searchOutcome.encodeCount,
        originalReturned: false,
      });
    }
    if (searchOutcome.status === "unreachable") {
      if (searchOutcome.bestCandidate) {
        const remainingForFinalDecode = deadline - Date.now();
        const verify = await verifyFinalOutput(
          searchOutcome.bestCandidate.pngBuffer,
          searchOutcome.bestCandidate.outputWidth,
          searchOutcome.bestCandidate.outputHeight,
          remainingForFinalDecode,
        );
        if (verify === "timeout") return respond({ status: "timeout" });
        if (verify === "invalid") {
          // 再デコードに失敗した診断用bestCandidateは転送しない(不正なbufferを送らない)。
          // 探索結果自体はunreachableのまま、bestCandidate無しで返す。
          return respond({ status: "unreachable", encodeCount: searchOutcome.encodeCount });
        }
      }
      return respond({
        status: "unreachable",
        bestCandidate: searchOutcome.bestCandidate,
        encodeCount: searchOutcome.encodeCount,
      });
    }
    if (searchOutcome.status === "timeout") {
      return respond({ status: "timeout", bestCandidateBytes: searchOutcome.bestCandidateBytes });
    }
    if (searchOutcome.status === "unsupported-png-encoder") {
      return respond({ status: "unsupported-png-encoder" });
    }
    return respond({ status: "error", message: searchOutcome.message });
  } catch (error) {
    respond({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
