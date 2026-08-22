/**
 * PNG指定容量圧縮UI層(use-png-compression.ts・PngCompressionWorkbench等)の型定義。
 * png-compression-types.tsのPngCompressionOutcome(Worker/クライアントの生の結果)とは別に、
 * UI表示・保存に必要な形(Object URL・出力ファイル名等)へ変換した後の型をここで定義する。
 * 既存のCompressionJob/PngToWebpJob(image-intake/compression-types.ts・png-to-webp-types.ts)と
 * 同じ設計方針を踏襲する。
 */

export interface PngCompressionSource {
  blob: Blob;
  width: number;
  height: number;
}

export interface PngCompressionUiResult {
  objectUrl: string;
  blob: Blob;
  outputFileName: string;
  /** 入力が既にtargetBytes以下で、再エンコードせず元ファイルをそのまま返した場合true */
  originalReturned: boolean;
  originalBytes: number;
  outputBytes: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  /** originalReturned=trueの場合はnull(色数削減を行っていないため) */
  colorCount: number | null;
  encodeCount: number;
  targetBytes: number;
}

export interface PngCompressionBestCandidateUiResult {
  objectUrl: string;
  blob: Blob;
  outputFileName: string;
  outputBytes: number;
  outputWidth: number;
  outputHeight: number;
  colorCount: number;
}

export interface PngCompressionUnreachableUiResult {
  targetBytes: number;
  originalWidth: number;
  originalHeight: number;
  /** 到達できた最良候補の再デコード検証まで成功した場合のみ存在する(png-compression.worker.ts参照) */
  bestCandidate?: PngCompressionBestCandidateUiResult;
}

export type PngCompressionFailureReason =
  | "animated-png"
  | "invalid-png"
  | "invalid-target"
  | "unsafe-dimensions"
  | "unsupported-browser"
  | "unsupported-png-encoder"
  | "timeout"
  | "too-large"
  | "error";

export type PngCompressionJobStatus =
  | { kind: "queued" }
  | { kind: "processing" }
  | { kind: "done"; result: PngCompressionUiResult }
  | { kind: "unreachable"; result: PngCompressionUnreachableUiResult }
  | { kind: "error"; reason: PngCompressionFailureReason; message: string }
  | { kind: "cancelled" }
  /** 完了(done)・未達(unreachable)の結果を表示した後に目標容量が変更され、その結果が
   * 新しい目標に対するものではなくなったことを示す。再度「圧縮する」を押すまでの中間状態。 */
  | { kind: "needs-reprocess" };

export interface PngCompressionJob {
  status: PngCompressionJobStatus;
}

/**
 * アイテムのPNG指定容量圧縮対応可否。
 * - not-ready: 解析中等
 * - unsupported-format: 解析済みだがPNG以外(JPEG・WebP・HEICはこのページの対象外)
 * - unsupported-browser: Worker/OffscreenCanvas/createImageBitmap/convertToBlobのいずれかが無い環境
 * - ready: 圧縮を開始できる状態(PNG)。APNG・壊れたPNG・寸法超過の最終判定はWorker側で行うため、
 *   ここでは検出形式がPNGであることのみを判定する(§9「Workerのstrict PNG検証を最終判定として使用」)。
 */
export type PngCompressionEligibility =
  | { kind: "not-ready" }
  | { kind: "unsupported-format" }
  | { kind: "unsupported-browser" }
  | { kind: "ready"; source: PngCompressionSource };
