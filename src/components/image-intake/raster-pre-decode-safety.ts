import { DECODE_SAFETY_LIMITS, validateDeclaredDimensions } from "./decode-safety";
import { readDeclaredDimensions } from "./image-header-dimensions";
import { getImageDimensions } from "./image-dimensions";
import type { ImageDimensions, SupportedImageFormat } from "./types";

/**
 * JPEG/PNG/WebPのpre-decode safety検証で扱う入力サイズ上限。avif-conversion-types.tsの
 * MAX_AVIF_INPUT_BYTESと同じ理由・同じ値を採用する: ヘッダー読み取りのためにfile.arrayBuffer()で
 * 圧縮ファイル全体をメモリへ読み込む必要があり、その読み込み自体が先にメモリを消費してしまわないよう、
 * 寸法ゲートより手前にかける入口制限である。「アップロード制限」ではない(このアプリはファイルを
 * アップロードしない)。
 */
export const MAX_RASTER_PRE_DECODE_INPUT_BYTES = 50 * 1024 * 1024; // 50 MiB

export type RasterPreDecodeFormat = Extract<SupportedImageFormat, "jpeg" | "png" | "webp">;

/**
 * useImageIntake({enableRasterPreDecodeSafety: true})経由のみで使われるpre-decode safety検証の結果。
 * readyの場合のみgetImageDimensions(=HTMLImageElementによる実デコード)を呼んでいる。
 */
export type RasterPreDecodeSafetyOutcome =
  | { kind: "too-large" }
  | { kind: "unsafe-dimensions" }
  | { kind: "decode-failed" }
  | { kind: "ready"; dimensions: ImageDimensions };

/**
 * JPEG/PNG/WebP向けのpre-decode safety検証。avif-isobmff.tsのavifPreflight(use-image-intake.ts内)と
 * 同じ位置づけの、opt-inの追加ゲートである。既定では既存の全ツールがgetImageDimensionsへ直接進む
 * (この関数を経由しない)ため、この関数を新設・使用しても既存ツールの挙動は一切変わらない。
 *
 * 1. file.size上限チェック(file.arrayBuffer()自体を呼ぶ前に拒否する)
 * 2. readDeclaredDimensions()でヘッダーから宣言寸法を読み取る(実デコードではない)
 * 3. validateDeclaredDimensions()でDECODE_SAFETY_LIMITSと照合する
 * 4. ここまで安全と判断できた場合のみgetImageDimensionsを呼ぶ
 *
 * ヘッダーが解析できない(readDeclaredDimensionsがnullを返す)場合はvalidateDeclaredDimensionsが
 * "missing-dimensions"を返すため、avifPreflightのftyp未解析時と同じくunsafe-dimensions側へ倒れる。
 * 実デコード自体はブラウザの実装に依存するため失敗し得る。原因(非対応コーデック/破損ファイル)を
 * 断定しないよう、decode-failedとして区別する(avifPreflightと同じ設計)。
 */
export async function rasterPreDecodeSafetyPreflight(
  file: File,
  objectUrl: string,
  format: RasterPreDecodeFormat,
): Promise<RasterPreDecodeSafetyOutcome> {
  if (file.size > MAX_RASTER_PRE_DECODE_INPUT_BYTES) {
    return { kind: "too-large" };
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const declared = readDeclaredDimensions(bytes, format);
  const safetyError = validateDeclaredDimensions(declared, DECODE_SAFETY_LIMITS);
  if (safetyError) {
    return { kind: "unsafe-dimensions" };
  }

  try {
    const dimensions = await getImageDimensions(objectUrl);
    return { kind: "ready", dimensions };
  } catch {
    return { kind: "decode-failed" };
  }
}
