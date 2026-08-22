export type PngToWebpQualityPreset = "high" | "standard" | "light";

export interface PngToWebpQualityOption {
  preset: PngToWebpQualityPreset;
  quality: number;
  label: string;
  description: string;
}

/**
 * MVPでは分かりやすい3段階の固定quality値のみを提供する(目標容量探索は行わない)。
 * 1.0は使用しない: WebPのCanvasエンコードでquality=1(または未指定)は、より小さいquality値より
 * 明らかに小さい出力になる実装差(ブラウザ既定値へのフォールバックと見られる挙動)が確認されているため、
 * 「最高画質」の意図に反する。0.90を最高画質として扱う。
 */
export const PNG_TO_WEBP_QUALITY_OPTIONS: PngToWebpQualityOption[] = [
  { preset: "high", quality: 0.9, label: "高画質", description: "画質を優先" },
  { preset: "standard", quality: 0.8, label: "標準", description: "画質と容量のバランス" },
  { preset: "light", quality: 0.65, label: "軽量", description: "ファイルサイズを優先" },
];

export const DEFAULT_PNG_TO_WEBP_QUALITY_PRESET: PngToWebpQualityPreset = "standard";

export function qualityForPreset(preset: PngToWebpQualityPreset): number {
  return PNG_TO_WEBP_QUALITY_OPTIONS.find((option) => option.preset === preset)!.quality;
}

/**
 * UIとWorkerで許可するquality値の定義がずれないよう、この判定を共通利用する。
 * PNG_TO_WEBP_QUALITY_OPTIONSに定義された3値(0.65/0.80/0.90)以外はすべて不正とする。
 */
export function isAllowedQuality(quality: number): boolean {
  return PNG_TO_WEBP_QUALITY_OPTIONS.some((option) => option.quality === quality);
}

export interface PngToWebpSource {
  blob: Blob;
  width: number;
  height: number;
}

export interface PngToWebpResult {
  objectUrl: string;
  blob: Blob;
  outputFileName: string;
  qualityPreset: PngToWebpQualityPreset;
  originalBytes: number;
  outputBytes: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  elapsedMs: number;
}

export type PngToWebpFailureReason =
  | "unsupported-animation"
  | "unsafe-dimensions"
  | "decode-failed"
  | "unsupported-webp-encoder"
  | "timeout"
  | "encode-failed";

export type PngToWebpJobStatus =
  | { kind: "queued" }
  | { kind: "processing" }
  | { kind: "done"; result: PngToWebpResult }
  | { kind: "error"; reason: PngToWebpFailureReason; message: string }
  | { kind: "cancelled" };

export interface PngToWebpJob {
  status: PngToWebpJobStatus;
}

/**
 * アイテムのPNG→WebP変換対応可否。
 * - not-ready: 解析中・PNGのAPNG/安全性チェック待ち等
 * - unsupported-format: 解析済みだがPNG以外(JPEG・WebP・HEICはこのページの対象外)
 * - unsupported-animation: アニメーションPNG(APNG)。先頭フレームだけの静止画への変換は行わないため対象外
 * - unsafe-dimensions: 宣言寸法・総ピクセル数が安全上限を超えるため、デコード前に拒否した
 * - unsupported-browser: Worker/OffscreenCanvas/createImageBitmap/convertToBlobのいずれかが無い環境
 * - ready: 変換を開始できる状態(通常PNG)
 */
export type PngToWebpEligibility =
  | { kind: "not-ready" }
  | { kind: "unsupported-format" }
  | { kind: "unsupported-animation" }
  | { kind: "unsafe-dimensions" }
  | { kind: "unsupported-browser" }
  | { kind: "ready"; source: PngToWebpSource };
