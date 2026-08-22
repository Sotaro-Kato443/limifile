/**
 * PNG→JPG・WebP→JPG・AVIF→JPG(将来的にはJPG→PNG・WebP→PNG等)で共有する、入力形式に
 * 依存しない型定義。png-to-webp-types.tsと同じ形(quality 3段階・Job/Eligibility状態)を踏襲しつつ、
 * 入力形式(sourceFormat)・出力の背景色(JPEG化に伴う透明部分の塗りつぶし色)をパラメータ化している。
 *
 * AVIFはPNG/WebPと寸法安全性検証の作り自体が異なる(avif-isobmff.tsのispe候補は複数あり得るため、
 * decode-safety.tsのDeclaredDimensions 1件では表現できない)。それでもJPEG出力パイプライン
 * (quality・背景色塗り潰し・Object URLライフサイクル等)は完全に共有するため、この型定義自体は
 * PNG/WebPと同じRasterSourceFormatの一員として扱う。
 */

export type RasterSourceFormat = "png" | "webp" | "avif";

export type RasterQualityPreset = "high" | "standard" | "light";

export interface RasterQualityOption {
  preset: RasterQualityPreset;
  quality: number;
}

/**
 * JPEG出力の品質3段階。PNG→WebP変換(png-to-webp-types.ts)と同じ値・同じ理由を踏襲する。
 * 1.0は使用しない: quality=1(または未指定)は、より小さいquality値より明らかに小さい出力になる
 * 実装差(ブラウザ既定値へのフォールバックと見られる挙動)がWebPエンコードで確認されており、
 * JPEGエンコードでも同じ設計を踏襲して0.90を最高画質として扱う。
 */
export const RASTER_QUALITY_OPTIONS: RasterQualityOption[] = [
  { preset: "high", quality: 0.9 },
  { preset: "standard", quality: 0.8 },
  { preset: "light", quality: 0.65 },
];

export const DEFAULT_RASTER_QUALITY_PRESET: RasterQualityPreset = "standard";

export function qualityForRasterPreset(preset: RasterQualityPreset): number {
  return RASTER_QUALITY_OPTIONS.find((option) => option.preset === preset)!.quality;
}

/**
 * UIとWorkerで許可するquality値の定義がずれないよう、この判定を共通利用する。
 * RASTER_QUALITY_OPTIONSに定義された3値(0.65/0.80/0.90)以外はすべて不正とする。
 */
export function isAllowedRasterQuality(quality: number): boolean {
  return RASTER_QUALITY_OPTIONS.some((option) => option.quality === quality);
}

/** JPEG化に伴う透明部分の塗りつぶし色(RGB各0-255)。既定はwhite(DEFAULT_RASTER_BACKGROUND) */
export interface RasterBackgroundColor {
  r: number;
  g: number;
  b: number;
}

export const DEFAULT_RASTER_BACKGROUND: RasterBackgroundColor = { r: 255, g: 255, b: 255 };

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/** `<input type="color">`表示用に#rrggbb形式へ変換する */
export function backgroundColorToHex(color: RasterBackgroundColor): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}

/** `<input type="color">`の入力値(常に#rrggbb形式)をRasterBackgroundColorへ変換する。解析できない場合はnull */
export function hexToBackgroundColor(hex: string): RasterBackgroundColor | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function isValidBackgroundChannel(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

/**
 * Workerが受け取ったbackgroundを最終的な安全境界として検証する(raster-convert.worker.ts参照)。
 * UI(hexToBackgroundColor)は常に0-255の整数を生成するはずだが、Worker側はpostMessageで届いた
 * 値を信頼せず、decode/encodeを開始する前に必ずこの検証を行う。
 */
export function isValidRasterBackground(background: RasterBackgroundColor): boolean {
  return (
    isValidBackgroundChannel(background.r) &&
    isValidBackgroundChannel(background.g) &&
    isValidBackgroundChannel(background.b)
  );
}

/** WorkerがsourceFormatを最終的な安全境界として検証するための判定(isAllowedRasterQualityと同じ位置づけ) */
export function isValidRasterSourceFormat(value: unknown): value is RasterSourceFormat {
  return value === "png" || value === "webp" || value === "avif";
}

export interface RasterToJpgSource {
  blob: Blob;
  width: number;
  height: number;
}

export interface RasterToJpgResult {
  objectUrl: string;
  blob: Blob;
  outputFileName: string;
  qualityPreset: RasterQualityPreset;
  /** 変換時に実際に使用した背景色(透明部分が無い画像でも記録する) */
  background: RasterBackgroundColor;
  originalBytes: number;
  outputBytes: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  elapsedMs: number;
}

export type RasterSizeChangeDirection = "reduced" | "increased";

export interface RasterSizeChange {
  direction: RasterSizeChangeDirection;
  /** 常に0以上の非負値。符号はdirectionが表すため、パーセント自体はマイナスにしない */
  percent: number;
}

/**
 * 変換前後のバイト数から、意味の通る増減表示を組み立てる。outputBytesがoriginalBytes以下
 * (同サイズを含む)の場合はdirection="reduced"、上回る場合は"increased"とし、パーセントは
 * どちらも0以上の非負値で返す(呼び出し側で"Reduction: -25%"のような矛盾した表示にしないため)。
 */
export function computeSizeChange(originalBytes: number, outputBytes: number): RasterSizeChange {
  if (originalBytes <= 0 || outputBytes <= originalBytes) {
    const percent = originalBytes > 0 ? Math.round((1 - outputBytes / originalBytes) * 100) : 0;
    return { direction: "reduced", percent };
  }
  const percent = Math.round((outputBytes / originalBytes - 1) * 100);
  return { direction: "increased", percent };
}

export type RasterToJpgFailureReason =
  | "unsupported-animation"
  | "unsafe-dimensions"
  | "decode-failed"
  | "unsupported-encoder"
  | "timeout"
  | "encode-failed"
  /**
   * Worker側でbuffer.byteLength > MAX_AVIF_INPUT_BYTESとして拒否された場合。intake側
   * (use-image-intake.ts)が既にfile.size上限を検証しているため、この経路は実際のUIからは
   * 到達しない想定の最終防御(Worker側の安全境界)だが、型として表現し必ずハンドリングする。
   */
  | "input-too-large";

export type RasterToJpgJobStatus =
  | { kind: "queued" }
  | { kind: "processing" }
  | { kind: "done"; result: RasterToJpgResult }
  | { kind: "error"; reason: RasterToJpgFailureReason; message: string }
  | { kind: "cancelled" };

export interface RasterToJpgJob {
  status: RasterToJpgJobStatus;
}

/**
 * アイテムのPNG/WebP/AVIF→JPG変換対応可否。
 * - not-ready: 解析中・アニメーション/安全性チェック待ち等
 * - unsupported-format: 解析済みだが対象のsourceFormat以外(PNG→JPGページならWebP等)
 * - unsupported-animation: アニメーションPNG(APNG)・アニメーションWebP・avisブランドを持つAVIF。
 *   先頭フレームだけの静止画への変換は行わないため対象外
 * - unsafe-dimensions: 宣言寸法・総ピクセル数が安全上限を超えるため、デコード前に拒否した
 *   (AVIFの場合は intake側(use-image-intake.ts)で既にispe候補を検証済みのため、この状態に
 *   到達する時点で既に安全と分かっている — sourceFor()参照)
 * - unsupported-browser: Worker/OffscreenCanvas/createImageBitmap/convertToBlobのいずれかが無い環境
 * - ready: 変換を開始できる状態
 */
export type RasterToJpgEligibility =
  | { kind: "not-ready" }
  | { kind: "unsupported-format" }
  | { kind: "unsupported-animation" }
  | { kind: "unsafe-dimensions" }
  | { kind: "unsupported-browser" }
  | { kind: "ready"; source: RasterToJpgSource };
