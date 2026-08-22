/**
 * AVIF(ISOBMFF)のうち、pre-decode safety検証に必要な部分だけを読み取るパーサ。
 *
 * 目的は「meta → iprp → ipco → ispe」ボックスを辿って宣言寸法の候補を集めることと、
 * ftypのcompatible_brandsにavis(image sequence)が含まれるかを判定すること。
 * pitm/ipmaによるprimary item(=実際に変換対象となるアイテム)の完全な解決は行わない
 * (avif-isobmff.test.tsとMVPの設計判断を参照)。
 *
 * 文字列検索でispe等のfourCCを拾う実装にはしない。box境界(32bit size・largesize・size=0・
 * nested box・meta等のFullBoxヘッダ)を正しく走査し、宣言サイズと実際に読み込めたバッファ長の
 * 両方を上限にして範囲外読み取りを避ける(ftyp-detection.tsのparseFtypBoxと同じ方針)。
 *
 * meta → iprp → ipco → ispeは固定4階層の経路であり、任意深さの再帰は行わない
 * (moov等、meta以外のトップレベルboxには潜らない)。
 */

/** 宣言寸法1件。AVIFは複数ispeを持ち得るため、呼び出し側は配列として扱う */
export interface AvifDimensionCandidate {
  width: number;
  height: number;
}

/** ftypのcompatible_brands等にavisが含まれる場合、animated(image sequence)として拒否する */
const AVIS_BRAND = "avis";

/** 異常なbox数(壊れたファイルによる無限ループ相当)を打ち切るための、同一階層内での走査上限 */
const MAX_BOXES_PER_LEVEL = 4096;

/** 汎用ボックスヘッダ(size, type)。largesize採用時はheaderSizeが16、それ以外は8 */
interface BoxHeader {
  type: string;
  /** ボックス全体(ヘッダ含む)のバイト数。size=0の場合はスキャン範囲の終端まで */
  totalSize: number;
  /** ヘッダ自体のバイト数(次の子ボックス/ペイロードの開始オフセットを得るために使う) */
  headerSize: number;
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

/** largesize(64bit)の近似読み取り。ftyp-detection.tsのreadUint64BEApproxと同じ方針 */
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
 * offsetにあるボックスのヘッダを読む。end(スキャン可能な範囲の終端)を超えて読み取らない。
 * 解析できない場合(バッファ不足・不正なsize)はnullを返す(例外は投げない)。
 */
function readBoxHeader(bytes: Uint8Array, offset: number, end: number): BoxHeader | null {
  if (offset + 8 > end) return null;

  const declaredSize = readUint32BE(bytes, offset);
  const type = readAscii4(bytes, offset + 4);

  if (declaredSize === 1) {
    // largesize: 通常のsizeフィールド(4byte)の直後8byteに実際のサイズが入る
    if (offset + 16 > end) return null;
    const totalSize = readUint64BEApprox(bytes, offset + 8);
    if (totalSize < 16) return null; // largesizeヘッダ自体より小さいsizeは不正
    return { type, totalSize, headerSize: 16 };
  }

  if (declaredSize === 0) {
    // 0は「このレベルのスキャン範囲の終端まで」を意味する
    return { type, totalSize: end - offset, headerSize: 8 };
  }

  if (declaredSize < 8) return null; // 通常ヘッダ自体(8byte)より小さいsizeは不正
  return { type, totalSize: declaredSize, headerSize: 8 };
}

/**
 * offsetからendまでの範囲を、同一階層のボックス列として走査する。
 * 各ボックスについて (type, ペイロード開始offset, ペイロード終端offset) をvisitorへ渡す。
 * 壊れたボックス(範囲外に及ぶsize、後退しないオフセット等)に達したら、その時点でスキャンを止める
 * (安全側: それ以上の解析を諦めるだけで、例外は投げない)。
 */
function walkBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  visitor: (type: string, payloadStart: number, payloadEnd: number) => void,
): void {
  let offset = start;
  let count = 0;

  while (offset < end) {
    if (count >= MAX_BOXES_PER_LEVEL) return;
    count += 1;

    const header = readBoxHeader(bytes, offset, end);
    if (!header) return;

    const boxEnd = offset + header.totalSize;
    // オーバーフロー・範囲外・後退(totalSizeがheaderSize未満)のいずれも安全側で打ち切る
    if (
      !Number.isFinite(boxEnd) ||
      boxEnd > end ||
      header.totalSize < header.headerSize ||
      boxEnd <= offset
    ) {
      return;
    }

    const payloadStart = offset + header.headerSize;
    visitor(header.type, payloadStart, boxEnd);

    offset = boxEnd;
  }
}

/** 指定した階層(startからendまで)から、最初に見つかった指定typeのboxのpayload範囲を返す */
function findFirstChildPayload(
  bytes: Uint8Array,
  start: number,
  end: number,
  targetType: string,
): { start: number; end: number } | null {
  let found: { start: number; end: number } | null = null;
  walkBoxes(bytes, start, end, (type, payloadStart, payloadEnd) => {
    if (found || type !== targetType) return;
    found = { start: payloadStart, end: payloadEnd };
  });
  return found;
}

/** ispeボックス(ImageSpatialExtentsProperty)のペイロードはFullBox(4byte) + width(4byte) + height(4byte) */
function parseIspePayload(
  bytes: Uint8Array,
  payloadStart: number,
  payloadEnd: number,
): AvifDimensionCandidate | null {
  const fieldsStart = payloadStart + 4; // FullBoxヘッダ(version+flags)をスキップ
  if (fieldsStart + 8 > payloadEnd) return null;

  const width = readUint32BE(bytes, fieldsStart);
  const height = readUint32BE(bytes, fieldsStart + 4);
  return { width, height };
}

/**
 * ipco(ItemPropertyContainerBox)直下のispeを全て集める。ipcoは通常のcontainer boxであり
 * FullBoxではないため、ペイロード先頭から直接子ボックス列として走査する。
 */
function collectIspeCandidates(
  bytes: Uint8Array,
  ipcoPayloadStart: number,
  ipcoPayloadEnd: number,
): AvifDimensionCandidate[] {
  const candidates: AvifDimensionCandidate[] = [];
  walkBoxes(bytes, ipcoPayloadStart, ipcoPayloadEnd, (type, payloadStart, payloadEnd) => {
    if (type !== "ispe") return;
    const candidate = parseIspePayload(bytes, payloadStart, payloadEnd);
    if (candidate) candidates.push(candidate);
  });
  return candidates;
}

/**
 * ftypのcompatible_brands(またはmajor_brand)にavisが含まれるかを判定する。
 * ftyp自体の解析はftyp-detection.tsのparseFtypBoxが担うため、ここではbrand一覧を受け取るだけにする。
 */
export function hasAvisBrand(brands: readonly string[]): boolean {
  return brands.includes(AVIS_BRAND);
}

/**
 * AVIFファイル全体のバイト列から、宣言されている寸法候補を全て取得する。
 * トップレベル → meta(FullBox) → iprp → ipco → ispe の経路を辿り、見つかった全てのispeを
 * そのまま返す(pitm/ipmaによる「どれが主画像か」の絞り込みは行わない — MVPの安全側の判断。
 * このファイル冒頭のコメントとavif-isobmff.test.tsを参照)。
 *
 * meta/iprp/ipcoのいずれかが見つからない、または構造が壊れている場合は空配列を返す
 * (例外は投げない)。呼び出し側(use-image-intake.ts・raster-convert.worker.ts)は
 * 空配列を「安全に検証できる寸法情報が無い」として拒否する。
 *
 * AVIFファイルはftyp直後にmetaを置くのが一般的だが、mdat等が先行する構成も許容されているため、
 * トップレベルのボックス列全体からmetaを探す(mdat等、meta以外のトップレベルboxには潜らない)。
 */
export function readAvifIspeCandidates(bytes: Uint8Array): AvifDimensionCandidate[] {
  const meta = findFirstChildPayload(bytes, 0, bytes.length, "meta");
  if (!meta) return [];

  // metaはFullBox(version 1byte + flags 3byte = 4byte)を先頭に持つため、
  // その4byteをスキップしてから子ボックス列として走査する。
  const metaChildrenStart = meta.start + 4;
  if (metaChildrenStart > meta.end) return [];

  const iprp = findFirstChildPayload(bytes, metaChildrenStart, meta.end, "iprp");
  if (!iprp) return [];

  const ipco = findFirstChildPayload(bytes, iprp.start, iprp.end, "ipco");
  if (!ipco) return [];

  return collectIspeCandidates(bytes, ipco.start, ipco.end);
}
