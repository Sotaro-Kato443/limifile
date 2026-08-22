export interface FtypBox {
  majorBrand: string;
  minorVersion: number;
  compatibleBrands: string[];
}

export type IsobmffClassification = "heic" | "avif" | "unknown";

/** iPhone等の実カメラ出力でHEIC/HEIFと十分な確度で判定できるブランド */
const HEIC_STRONG_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);

/** AVIF系ブランド。HEIC系ブランドと同居していてもこちらを優先する */
const AVIF_BRANDS = new Set(["avif", "avis"]);

// 'mif1'/'msf1'は汎用MIAFコンテナやAVIFでも使われ得るため、
// 単独ではHEICの根拠として扱わない(意図的にHEIC_STRONG_BRANDSへ含めていない)。

const FTYP_BOX_TYPE = "ftyp";
/** size(4) + type(4) + major_brand(4) + minor_version(4) */
const MIN_FTYP_HEADER_BYTES = 16;

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** largesize(64bit)の近似読み取り。ftypがこの桁数になることは実運用上想定しないが安全側に倒す */
function readUint64BEApprox(bytes: Uint8Array, offset: number): number {
  const high = readUint32BE(bytes, offset);
  const low = readUint32BE(bytes, offset + 4);
  return high * 2 ** 32 + low;
}

function readAscii4(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

/**
 * ISOBMFFのftypボックスを解析する。
 * 不正なボックスサイズ・短すぎるバッファ・範囲外読み取りが起きる入力に対しても
 * 例外を投げず、解析できない場合はnullを返す。
 */
export function parseFtypBox(bytes: Uint8Array): FtypBox | null {
  if (bytes.length < MIN_FTYP_HEADER_BYTES) return null;

  const declaredSize = readUint32BE(bytes, 0);
  const boxType = readAscii4(bytes, 4);
  if (boxType !== FTYP_BOX_TYPE) return null;

  let brandOffset = 8;
  let effectiveSize: number;

  if (declaredSize === 1) {
    // largesize: sizeフィールドの直後8バイトに実際のサイズが格納される
    if (bytes.length < 16) return null;
    effectiveSize = readUint64BEApprox(bytes, 8);
    brandOffset = 16;
  } else if (declaredSize === 0) {
    // 0は「ファイル末尾まで」を意味する。読み込めたバッファ長を上限として扱う
    effectiveSize = bytes.length;
  } else {
    effectiveSize = declaredSize;
  }

  if (effectiveSize < brandOffset + 8 || bytes.length < brandOffset + 8) return null;

  const majorBrand = readAscii4(bytes, brandOffset);
  const minorVersion = readUint32BE(bytes, brandOffset + 4);

  const compatibleBrands: string[] = [];
  // 宣言サイズと実際に読み込めたバッファ長の小さい方を上限にし、範囲外読み取りを避ける
  const end = Math.min(effectiveSize, bytes.length);
  for (let offset = brandOffset + 8; offset + 4 <= end; offset += 4) {
    compatibleBrands.push(readAscii4(bytes, offset));
  }

  return { majorBrand, minorVersion, compatibleBrands };
}

/**
 * major_brand・compatible_brandsからHEIC/AVIF/不明を判定する。
 * AVIF系ブランドが含まれる場合は、HEIC系ブランドが同居していてもAVIF判定を優先し、
 * HEICデコーダ(HEVC用)へAVIF(AV1)ファイルを誤って渡さないようにする。
 */
export function classifyIsobmff(ftyp: FtypBox): IsobmffClassification {
  const allBrands = [ftyp.majorBrand, ...ftyp.compatibleBrands];
  if (allBrands.some((brand) => AVIF_BRANDS.has(brand))) return "avif";
  if (allBrands.some((brand) => HEIC_STRONG_BRANDS.has(brand))) return "heic";
  return "unknown";
}
