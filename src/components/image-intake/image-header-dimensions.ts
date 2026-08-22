import { readWebpChunks } from "./webp-riff";
import type { SupportedImageFormat } from "./types";

export interface DeclaredDimensions {
  width: number;
  height: number;
}

/** 異常に多いマーカー/チャンクを持つファイルの走査を打ち切るための安全上限(jpeg-metadata.tsのMAX_MARKERSに準拠) */
const MAX_SEGMENTS_TO_SCAN = 1024;

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

// SOF0-3, SOF5-7, SOF9-11, SOF13-15。DHT(0xC4)・JPG拡張予約(0xC8)・DAC(0xCC)はSOFではないため除外する
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
// 長さフィールドを持たないスタンドアロンマーカー: TEM(0x01), RSTn(0xD0-0xD7)
const NO_LENGTH_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;

/**
 * JPEGバイト列からSOF系マーカーのheight/widthを読み取る。再エンコード等は行わない、寸法の読み取りのみ。
 * 不正・欠損・切り詰めされたバイト列に対しては例外を投げず、常にnullを返す。
 */
function readJpegDimensions(bytes: Uint8Array): DeclaredDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null;

  let pos = 2;
  let segmentCount = 0;

  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    let markerPos = pos;
    while (markerPos < bytes.length && bytes[markerPos] === 0xff) markerPos++;
    if (markerPos >= bytes.length) return null;
    const marker = bytes[markerPos];
    pos = markerPos + 1;

    segmentCount++;
    if (segmentCount > MAX_SEGMENTS_TO_SCAN) return null;

    if (marker === EOI || marker === SOS) return null; // SOFに到達せず終端/スキャン開始
    if (NO_LENGTH_MARKERS.has(marker)) continue;

    if (pos + 2 > bytes.length) return null;
    const len = readUint16BE(bytes, pos);
    if (len < 2 || pos + len > bytes.length) return null;

    if (SOF_MARKERS.has(marker)) {
      // SOFペイロード: precision(1) + height(2) + width(2) + ...
      if (pos + 5 > bytes.length) return null;
      const height = readUint16BE(bytes, pos + 3);
      const width = readUint16BE(bytes, pos + 5);
      return { width, height };
    }

    pos += len;
  }
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNGバイト列からIHDRチャンク(署名直後に必ず存在する)のwidth/heightを読み取る */
function readPngDimensions(bytes: Uint8Array): DeclaredDimensions | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== "IHDR") return null;

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return { width, height };
}

/**
 * WebPバイト列(RIFF/WEBPコンテナ)からVP8X(拡張ヘッダー)のcanvasサイズ、
 * またはVP8/VP8L(単純形式)のビットストリームからwidth/heightを読み取る。
 * RIFFコンテナ自体の妥当性検証(全体サイズ・末尾の一致・チャンク範囲等)はwebp-riff.tsが担い、
 * この関数はチャンク列から寸法情報を抽出することだけに専念する。
 * 壊れたRIFF/チャンク長が範囲外/整数オーバーフロー相当の入力に対しても例外を投げず、
 * 解析できない場合は常にnullを返す。
 */
function readWebpDimensions(bytes: Uint8Array): DeclaredDimensions | null {
  const chunks = readWebpChunks(bytes);
  if (typeof chunks === "string") return null; // "not-webp" | "malformed"

  for (const { fourCC, payloadStart, payloadEnd } of chunks) {
    if (fourCC === "VP8X") {
      if (payloadEnd - payloadStart < 10) return null;
      const widthMinus1 =
        bytes[payloadStart + 4] | (bytes[payloadStart + 5] << 8) | (bytes[payloadStart + 6] << 16);
      const heightMinus1 =
        bytes[payloadStart + 7] | (bytes[payloadStart + 8] << 8) | (bytes[payloadStart + 9] << 16);
      return { width: widthMinus1 + 1, height: heightMinus1 + 1 };
    }

    if (fourCC === "VP8 ") {
      if (payloadEnd - payloadStart < 10) return null;
      const hasStartCode =
        bytes[payloadStart + 3] === 0x9d &&
        bytes[payloadStart + 4] === 0x01 &&
        bytes[payloadStart + 5] === 0x2a;
      if (!hasStartCode) return null;
      const width = readUint16LE(bytes, payloadStart + 6) & 0x3fff;
      const height = readUint16LE(bytes, payloadStart + 8) & 0x3fff;
      return { width, height };
    }

    if (fourCC === "VP8L") {
      if (payloadEnd - payloadStart < 5) return null;
      if (bytes[payloadStart] !== 0x2f) return null;
      const packed = readUint32LE(bytes, payloadStart + 1);
      const width = (packed & 0x3fff) + 1;
      const height = ((packed >>> 14) & 0x3fff) + 1;
      return { width, height };
    }
  }
  return null;
}

/**
 * ファイルの生バイト列と検出済み形式から、デコードせずヘッダーだけで宣言された寸法を読み取る。
 * createImageBitmap等の実デコードを呼ぶ前に、安全性検証(decode-safety.ts)へ渡すために使う。
 * HEICはこの関数の対象外(既存のHEIC Workerのデコード結果から寸法を得るため)。
 */
export function readDeclaredDimensions(
  bytes: Uint8Array,
  format: SupportedImageFormat,
): DeclaredDimensions | null {
  switch (format) {
    case "jpeg":
      return readJpegDimensions(bytes);
    case "png":
      return readPngDimensions(bytes);
    case "webp":
      return readWebpDimensions(bytes);
    case "heic":
      return null;
    case "avif":
      // AVIFはこの関数の対象外。宣言寸法はavif-isobmff.tsのreadAvifIspeCandidatesが
      // 複数候補として返す(HEICと異なり、AVIFの安全性検証は個別候補の配列を扱うため、
      // この関数が返すDeclaredDimensions | null 1件の形では表現できない)。
      return null;
  }
}
