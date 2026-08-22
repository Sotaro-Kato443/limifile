import type { RasterBackgroundColor } from "./raster-convert-types";

/** target-fit.worker.tsが実際にデコードできる入力形式。将来拡張する場合はこことworker側の両方を広げる */
export type TargetFitSourceFormat = "jpeg" | "png";

/**
 * 指定した幅×高さへ画像を合わせる汎用コア(target-fit-*.ts)の型定義。
 * "signature"等の用途固有概念は一切含まない。署名以外の用途固有Workbenchからも
 * 同じコアをそのまま再利用できることを前提とした設計にしている。
 *
 * 設計方針(SignatureResizerWorkbench導入時にレビュー済み):
 * - 幅・高さは最初に確定し、以後変更しない(既存の圧縮系ツールのようにdimensionを
 *   自由変数としてbyte目標を満たす設計ではない。自由変数はJPEG qualityのみ)。
 * - 出力形式はv1ではJPEG固定。将来的な出力形式選択肢は、実際に必要になった時点で
 *   型を拡張する(TargetFitRequestに現時点でoutputFormatフィールドを持たせない)。
 */

/** v1は"contain"(既定)と"stretch"のみ。"cover"(crop)は別途、crop UIと同時に設計する */
export type FitMode = "contain" | "stretch";

export interface TargetFitRequest {
  targetWidth: number;
  targetHeight: number;
  /** バイト単位。人工的な下限は設けない(呼び出し側フォームでpositive値のみ許容する) */
  maxBytes: number;
  fitMode: FitMode;
  background: RasterBackgroundColor;
}

/** target-fit.worker.tsが実際に生成した1候補(条件を満たしたかどうかは問わない) */
export interface TargetFitCandidate {
  /** JPEG固定。BlobではなくpostMessageで転送可能なArrayBuffer本体を持つ */
  jpegBuffer: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
  bytes: number;
  /** convertToBlobが実際に返したBlob.type。"image/jpeg"以外ならformat条件は満たさない */
  mimeType: string;
  /** contain modeで元画像より拡大した場合true。エラーではなく警告表示に使う */
  upscaled: boolean;
}

/**
 * target-fit.worker.tsの入力サイズ上限。avif-conversion-types.tsのMAX_AVIF_INPUT_BYTESと
 * 同じ理由・同じ値(readDeclaredDimensions等のためにbuffer全体をメモリへ保持する必要があり、
 * その確保自体が先にメモリを圧迫しないための入口制限)。
 */
export const MAX_TARGET_FIT_INPUT_BYTES = 50 * 1024 * 1024; // 50 MiB

export interface TargetFitLimits {
  /**
   * JPEG qualityの探索範囲。[0.35, 0.92]を暫定採用(既存image-compress.worker.tsと同じ値)。
   * merge前に署名風・証明写真風の自作画像で10/20/50KB等の実測QAを行い、0.35が実用上高すぎないか
   * 確認済み(小さいpx寸法(実際の署名サイズに近い140×60px等)では0.35のfloorに遠く及ばず、
   * 大きめの出力寸法×厳しいKB上限×高周波コンテンツの組み合わせでのみfloorが実際に効くことを確認した)。
   */
  qualityRange: [number, number];
  /**
   * floor probe(qualityRange[0]、1回)・qualityHi probe(qualityRange[1]、1回)を除いた、
   * 二分探索側の最大反復回数。qualityHi probeがmaxBytes以下を満たした場合、二分探索自体を
   * 行わないため、実際のencode回数は最大でも 2 + maxQualityIterations 回(floor 1 + hi 1 +
   * 二分探索最大maxQualityIterations回)、qualityHiが収まる場合は 2 回のみで済む。
   */
  maxQualityIterations: number;
  /** 処理時間の上限(ミリ秒) */
  timeBudgetMs: number;
}

export const DEFAULT_TARGET_FIT_LIMITS: TargetFitLimits = {
  qualityRange: [0.35, 0.92],
  maxQualityIterations: 8,
  timeBudgetMs: 15000,
};

export interface TargetFitConditionChecklist {
  width: { ok: boolean; actual: number; target: number };
  height: { ok: boolean; actual: number; target: number };
  size: { ok: boolean; actualBytes: number; maxBytes: number };
  format: { ok: boolean; actual: string };
}

/**
 * target-fit.worker.ts自身が計算しうる結果。"cancelled"を含まない
 * (キャンセルはtarget-fit-client.tsが外部から注入する概念であり、Worker自身は関知しないため。
 * image-compress.worker.tsのCompressOutcome/image-compression-client.tsのCompressOutcomeの
 * 関係と同じ設計 — Client側で改めて"cancelled"を加えた別の型として公開する)。
 */
export type TargetFitOutcome =
  | { status: "done"; candidate: TargetFitCandidate; encodeCount: number; elapsedMs: number }
  | {
      status: "unreachable";
      bestCandidate: TargetFitCandidate;
      encodeCount: number;
      elapsedMs: number;
    }
  | { status: "unsupported-animation" }
  | { status: "unsafe-dimensions" }
  | { status: "invalid-request" }
  | { status: "unsupported-encoder" }
  | { status: "timeout" }
  | { status: "error"; message: string };

/** useTargetFit(use-target-fit.ts)が扱うアイテムの入力元。IntakeItemから抽出した最小限の情報のみを持つ */
export interface TargetFitSource {
  blob: Blob;
  width: number;
  height: number;
  format: TargetFitSourceFormat;
}

/**
 * アイテムのtarget-fit対応可否。
 * - not-ready: 解析中・allowedSourceFormats対象外形式が"ready"にすら到達していない等
 * - unsupported-format: 解析済みだがallowedSourceFormats対象外(intake側のallowedFormatsで
 *   既にunsupported-formatとして拒否されている場合。use-raster-to-jpg.tsのisWrongFormatRejectedと
 *   同じ設計)
 * - unsupported-browser: Worker/OffscreenCanvas/createImageBitmap/convertToBlobのいずれかが無い環境
 * - ready: 変換を開始できる状態
 */
export type TargetFitEligibility =
  | { kind: "not-ready" }
  | { kind: "unsupported-format" }
  | { kind: "unsupported-browser" }
  | { kind: "ready"; source: TargetFitSource };

/**
 * done/unreachableいずれの場合も同じ形の結果を持つ。unreachableでもcandidate自体は必ず存在し
 * (target-fit.worker.tsのfloor probeが保証する)、ダウンロード可能な状態として提示できる。
 * checklistのどの項目がokかどうかで、呼び出し側(SignatureResizerWorkbench)がdone/unreachableの
 * 違いを表示で使い分ける。
 */
export interface TargetFitResult {
  objectUrl: string;
  blob: Blob;
  outputFileName: string;
  request: TargetFitRequest;
  checklist: TargetFitConditionChecklist;
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  outputBytes: number;
  quality: number;
  upscaled: boolean;
  encodeCount: number;
  elapsedMs: number;
}

export type TargetFitFailureReason =
  | "unsupported-animation"
  | "unsafe-dimensions"
  | "invalid-request"
  | "unsupported-encoder"
  | "timeout"
  | "encode-failed";

export type TargetFitJobStatus =
  | { kind: "queued" }
  | { kind: "processing" }
  | { kind: "done"; result: TargetFitResult }
  | { kind: "unreachable"; result: TargetFitResult }
  | { kind: "error"; reason: TargetFitFailureReason; message: string }
  | { kind: "cancelled" };

export interface TargetFitJob {
  request: TargetFitRequest;
  status: TargetFitJobStatus;
}
