import { classifyIsobmff, parseFtypBox } from "./ftyp-detection";
import type { SupportedImageFormat } from "./types";

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]; // "WEBP" (RIFF先頭から8バイト目)

// ftypのcompatible_brandsまで読み取れるよう、単純なマジックバイト判定に必要な量より余裕を持たせる
const HEADER_BYTES_NEEDED = 128;

function matchesSignature(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * ファイル先頭のマジックバイト(JPEG/PNG/WebP)またはISOBMFFのftypボックス(HEIC/HEIF・AVIF)から
 * 実際の画像形式を判定する。いずれにも一致しないバイト列は未対応形式としてnullを返す。
 */
export async function detectImageFormat(file: File): Promise<SupportedImageFormat | null> {
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES_NEEDED).arrayBuffer());

  if (matchesSignature(header, JPEG_SIGNATURE)) return "jpeg";
  if (matchesSignature(header, PNG_SIGNATURE)) return "png";
  if (matchesSignature(header, RIFF_SIGNATURE, 0) && matchesSignature(header, WEBP_SIGNATURE, 8)) {
    return "webp";
  }

  const ftyp = parseFtypBox(header);
  if (ftyp) {
    const classification = classifyIsobmff(ftyp);
    if (classification === "heic") return "heic";
    if (classification === "avif") return "avif";
  }

  return null;
}

const EXTENSION_TO_FORMAT: Record<string, SupportedImageFormat> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heic",
  heif: "heic",
  avif: "avif",
};

export function extractExtension(fileName: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : null;
}

export function extensionImpliedFormat(fileName: string): SupportedImageFormat | null {
  const extension = extractExtension(fileName);
  return extension ? (EXTENSION_TO_FORMAT[extension] ?? null) : null;
}

/**
 * 拡張子と実形式が食い違っているかどうかを判定する。
 * 実形式が未対応(null)の場合は「不一致警告」ではなく別のエラー表示で扱うためfalseを返す。
 * 拡張子から形式を推測できない場合も警告対象外とする。
 */
export function hasExtensionMismatch(
  detectedFormat: SupportedImageFormat | null,
  fileName: string,
): boolean {
  if (!detectedFormat) return false;
  const implied = extensionImpliedFormat(fileName);
  if (!implied) return false;
  return implied !== detectedFormat;
}
