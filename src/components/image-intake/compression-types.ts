export type SizeUnit = "KB" | "MB";

/** 圧縮入力の由来。UI文言の出し分け(HEICはJPGに変換したうえで圧縮する旨の表示)に使う */
export type CompressionSourceKind = "jpeg" | "heic-derived-jpeg" | "webp";

/** 圧縮結果の出力形式。ファイル名・MIME・プレビュー文言の出し分けに使う */
export type CompressionOutputFormat = "jpeg" | "webp";

export interface CompressionSource {
  kind: CompressionSourceKind;
  blob: Blob;
  width: number;
  height: number;
}

export interface CompressionTarget {
  bytes: number;
  /** 出力ファイル名生成用ラベル(例: "500kb", "1mb", "1-5mb") */
  label: string;
  /** 画面表示用(例: "500KB") */
  displayText: string;
}

export type CompressionPhase = "preparing" | "quality" | "resize" | "finalizing";

export interface CompressionProgress {
  phase: CompressionPhase;
  attempt: number;
  maxAttempts: number;
}

export interface CompressionResult {
  objectUrl: string;
  blob: Blob;
  outputFileName: string;
  /** 出力形式。ファイル名拡張子・MIME・プレビュー/保存ボタンの文言出し分けに使う */
  outputFormat: CompressionOutputFormat;
  /** 元Blobが既に目標容量以下で、再エンコードしなかった場合true */
  unchanged: boolean;
  originalBytes: number;
  outputBytes: number;
  targetBytes: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  encodeCount: number;
  resizeCount: number;
  elapsedMs: number;
}

export type CompressionFailureReason =
  | "target-unreachable"
  | "encode-failed"
  | "decode-failed"
  | "unsafe-dimensions"
  | "unsupported-webp-encoder"
  | "unsupported-animation";

export type CompressionJobStatus =
  | { kind: "queued" }
  | { kind: "processing"; progress: CompressionProgress }
  | { kind: "done"; result: CompressionResult }
  | { kind: "error"; reason: CompressionFailureReason; message: string }
  | { kind: "cancelled" };

export interface CompressionJob {
  target: CompressionTarget;
  status: CompressionJobStatus;
}

/**
 * アイテムごとの圧縮対応可否。
 * - not-ready: 解析中/HEIC変換待ち・変換中/エラー/未対応形式(JPG・PNG・WebP・HEIC以外)/
 *   WebPのアニメーション・安全性チェック待ち
 * - unsupported-format: 解析済みだがPNG(今回は圧縮対象外)
 * - unsupported-animation: アニメーションWebP(先頭フレームだけの静止画への変換は行わないため対象外)
 * - unsafe-dimensions: 宣言寸法・総ピクセル数が安全上限を超えるため、デコード前に拒否した
 * - unsupported-browser: Worker/OffscreenCanvas/createImageBitmap/convertToBlobのいずれかが無い環境
 * - ready: 圧縮を開始できる状態(JPEG本体、HEIC変換後のJPEG、または静止WebP)
 */
export type CompressionEligibility =
  | { kind: "not-ready" }
  | { kind: "unsupported-format" }
  | { kind: "unsupported-animation" }
  | { kind: "unsafe-dimensions" }
  | { kind: "unsupported-browser" }
  | { kind: "ready"; source: CompressionSource };
