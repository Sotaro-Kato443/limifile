/**
 * JPEGバイナリを再エンコードせず、許可リスト方式でメタデータ領域を削除する。
 *
 * 方針: 「既知の削除対象だけを消す」拒否リストではなく、「表示・色の維持に必要な
 * セグメントだけを残す」許可リストを採用する。未知のAPPn/COMは常に削除する。
 * 各SOS〜次の実マーカーまでのエントロピー符号化データは一切解析・変更せず、不透明な
 * バイト列として維持する(プログレッシブJPEG等の複数SOSにも対応し、スキャン間の
 * APPn/COMにも同じ許可リストを適用する)。最初の有効なEOIに到達した時点で出力を終了し、
 * それ以降のバイト列(連結された別画像・MPO追加画像等)はすべて破棄する。
 */

export type RemoveExifErrorCode =
  | "invalid-jpeg"
  | "invalid-segment-length"
  | "missing-eoi"
  | "invalid-jfif"
  | "malformed-exif"
  | "ambiguous-orientation"
  | "limit-exceeded";

export class RemoveExifError extends Error {
  readonly code: RemoveExifErrorCode;
  constructor(code: RemoveExifErrorCode, message: string) {
    super(message);
    this.name = "RemoveExifError";
    this.code = code;
  }
}

/** テスト・デバッグ用の削除領域ラベル。UI表示は固定文言のため、この値をそのまま出し分けには使わない */
export type RemovedRegion =
  | "app0-thumbnail"
  | "app0-jfxx"
  | "app0-unknown"
  | "app1-exif"
  | "app1-xmp"
  | "app1-unknown"
  | "app2-unknown"
  | "app3-app12"
  | "app13"
  | "app14-unknown"
  | "app15"
  | "com";

export interface JpegMetadataResult {
  output: ArrayBuffer;
  removedRegions: RemovedRegion[];
  /** 表示方向を保つためのOrientationタグのみを持つ最小EXIFを新規生成したか */
  orientationKept: boolean;
  /** 保持したOrientation値(2〜8)。保持しなかった場合はnull */
  orientationValue: number | null;
  /** ICC_PROFILE(APP2)を1つ以上維持したか */
  iccKept: boolean;
}

/** マーカー数の安全上限(実在のJPEGは通常100未満)。異常に大量のセグメントを持つファイルを拒否する */
export const MAX_MARKERS = 1024;
/** TIFF IFDエントリ数の安全上限(実在のIFD0は通常30未満) */
export const MAX_IFD_ENTRIES = 256;
/** SOS(スキャン)数の安全上限(プログレッシブJPEGでも通常20未満)。異常に多いスキャンを拒否する */
export const MAX_SCANS = 64;

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
// スタンドアロンマーカー(長さフィールドを持たない): TEM(0x01), RSTn(0xD0-0xD7)
const NO_LENGTH_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

const JFIF_ID = asciiCodes("JFIF\0");
const JFXX_ID = asciiCodes("JFXX\0");
const EXIF_ID = asciiCodes("Exif\0\0");
const XMP_ID = asciiCodes("http://ns.adobe.com/xap/1.0/\0");
const ICC_PROFILE_ID = asciiCodes("ICC_PROFILE\0");
const ADOBE_ID = asciiCodes("Adobe");

function asciiCodes(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}

function matchesId(bytes: Uint8Array, start: number, end: number, id: number[]): boolean {
  if (end - start < id.length) return false;
  for (let i = 0; i < id.length; i++) {
    if (bytes[start + i] !== id[i]) return false;
  }
  return true;
}

/**
 * 単一のExif APP1セグメント(TIFF IFD0)からOrientationタグ(0x0112)の値を読み取る。
 * type/count/値のいずれかが不正な場合は例外を投げる(呼び出し側で「成功扱いにしない」ため)。
 * オフセット計算はすべて通常の数値演算のみで行い、ビット演算(オーバーフロー相当の危険がある)は使わない。
 */
function readOrientationCandidates(
  bytes: Uint8Array,
  payloadStart: number,
  payloadEnd: number,
): number[] {
  const tiffStart = payloadStart + EXIF_ID.length;
  const tiffLength = payloadEnd - tiffStart;
  if (tiffLength < 8) {
    throw new RemoveExifError("malformed-exif", "TIFFヘッダーが短すぎます");
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset + tiffStart, tiffLength);
  const byteOrderMark = dv.getUint16(0, false);
  let little: boolean;
  if (byteOrderMark === 0x4949) {
    little = true;
  } else if (byteOrderMark === 0x4d4d) {
    little = false;
  } else {
    throw new RemoveExifError("malformed-exif", "TIFFバイトオーダーマークが不正です");
  }

  const magic = dv.getUint16(2, little);
  if (magic !== 42) {
    throw new RemoveExifError("malformed-exif", "TIFFマジックナンバーが不正です");
  }

  const ifd0Offset = dv.getUint32(4, little);
  if (ifd0Offset + 2 > tiffLength) {
    throw new RemoveExifError("malformed-exif", "IFD0オフセットがTIFF範囲外です");
  }

  const entryCount = dv.getUint16(ifd0Offset, little);
  if (entryCount > MAX_IFD_ENTRIES) {
    throw new RemoveExifError("limit-exceeded", "IFD0のエントリ数が上限を超えています");
  }

  const entriesEnd = ifd0Offset + 2 + entryCount * 12;
  if (entriesEnd > tiffLength) {
    throw new RemoveExifError("malformed-exif", "IFD0のエントリがTIFF範囲を超えています");
  }

  const values: number[] = [];
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    const tag = dv.getUint16(entryOffset, little);
    if (tag !== 0x0112) continue;

    const type = dv.getUint16(entryOffset + 2, little);
    if (type !== 3) {
      throw new RemoveExifError("malformed-exif", "Orientationタグの型がSHORTではありません");
    }
    const count = dv.getUint32(entryOffset + 4, little);
    if (count !== 1) {
      throw new RemoveExifError("malformed-exif", "Orientationタグのcountが1ではありません");
    }
    const value = dv.getUint16(entryOffset + 8, little);
    if (value < 1 || value > 8) {
      throw new RemoveExifError("malformed-exif", `Orientationの値が範囲外です(${value})`);
    }
    values.push(value);
  }
  return values;
}

/** Orientationタグ1個だけを持つ最小のExif APP1セグメントを生成する */
function buildMinimalOrientationApp1(orientation: number): Uint8Array {
  // TIFFヘッダ(8) + IFD0(count(2)+entry(12)+nextOffset(4)=18) = 26byte
  const tiff = new Uint8Array(26);
  const dv = new DataView(tiff.buffer);
  dv.setUint8(0, 0x49);
  dv.setUint8(1, 0x49); // "II" little-endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true); // IFD0 offset
  dv.setUint16(8, 1, true); // entry count = 1
  dv.setUint16(10, 0x0112, true); // tag: Orientation
  dv.setUint16(12, 3, true); // type: SHORT
  dv.setUint32(14, 1, true); // count
  dv.setUint16(18, orientation, true); // value
  dv.setUint16(20, 0, true); // padding(残り2byte)
  dv.setUint32(22, 0, true); // next IFD offset = 0

  const payload = new Uint8Array(EXIF_ID.length + tiff.length);
  payload.set(EXIF_ID, 0);
  payload.set(tiff, EXIF_ID.length);

  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg[2] = Math.floor((payload.length + 2) / 256);
  seg[3] = (payload.length + 2) % 256;
  seg.set(payload, 4);
  return seg;
}

/**
 * 有効なJFIF APP0を、必須フィールドだけを残した最小構成(サムネイル無し)へ再構築する。
 * JFIF長・サムネイル長が内部的に矛盾している場合は例外を投げる(安全に失敗させる)。
 */
function buildMinimalJfifApp0(
  bytes: Uint8Array,
  payloadStart: number,
  payloadEnd: number,
): Uint8Array {
  const payloadLength = payloadEnd - payloadStart;
  // "JFIF\0"(5) + version(2) + units(1) + Xdensity(2) + Ydensity(2) + thumbW(1) + thumbH(1) = 14
  if (payloadLength < 14) {
    throw new RemoveExifError("invalid-jfif", "JFIFセグメント長が不正です");
  }

  const versionMajor = bytes[payloadStart + 5];
  const versionMinor = bytes[payloadStart + 6];
  const units = bytes[payloadStart + 7];
  const xDensityHi = bytes[payloadStart + 8];
  const xDensityLo = bytes[payloadStart + 9];
  const yDensityHi = bytes[payloadStart + 10];
  const yDensityLo = bytes[payloadStart + 11];
  const thumbWidth = bytes[payloadStart + 12];
  const thumbHeight = bytes[payloadStart + 13];

  const requiredLength = 14 + 3 * thumbWidth * thumbHeight;
  if (payloadLength < requiredLength) {
    throw new RemoveExifError("invalid-jfif", "JFIFサムネイル長が不正です");
  }

  const out = new Uint8Array(18); // marker(2) + length(2) + payload(14)
  out[0] = 0xff;
  out[1] = 0xe0;
  out[2] = 0x00;
  out[3] = 0x10; // payload(14) + length自体(2) = 16
  out.set(JFIF_ID, 4);
  out[9] = versionMajor;
  out[10] = versionMinor;
  out[11] = units;
  out[12] = xDensityHi;
  out[13] = xDensityLo;
  out[14] = yDensityHi;
  out[15] = yDensityLo;
  out[16] = 0; // thumbnail width = 0
  out[17] = 0; // thumbnail height = 0
  return out;
}

function isIccApp2(bytes: Uint8Array, payloadStart: number, payloadEnd: number): boolean {
  return matchesId(bytes, payloadStart, payloadEnd, ICC_PROFILE_ID);
}

interface EntropyScanResult {
  /** エントロピー符号化データの終端(この位置を含まない)。バイト単位で一切変更しない */
  entropyEnd: number;
  /** 次に通常のマーカー解析を再開すべき位置(見つかった実マーカーの0xFFバイトの位置) */
  nextMarkerPos: number;
}

/**
 * SOSヘッダ直後からエントロピー符号化データを走査し、次の「実マーカー」の直前までを
 * 画像データとして特定する。バイトスタッフィング(FF 00)・Restart Marker(FF D0〜D7)・
 * 複数連続するFF(fill byte)を考慮し、これら以外の0xFFに後続するバイトを実マーカーの
 * 開始とみなす。エントロピー符号化データ自体は一切解析・変更しない(位置の特定のみ行う)。
 */
function consumeEntropyData(bytes: Uint8Array, start: number): EntropyScanResult {
  let i = start;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    // 0xFFのランを探す(1個以上)
    let j = i + 1;
    while (j < bytes.length && bytes[j] === 0xff) j++;
    if (j >= bytes.length) {
      throw new RemoveExifError(
        "missing-eoi",
        "エントロピー符号化データが切断されています(マーカーが見つかりません)",
      );
    }
    const term = bytes[j];
    if (term === 0x00 || (term >= 0xd0 && term <= 0xd7)) {
      // スタッフィングされたFF、またはRestart Marker: ランごと画像データの一部として扱い、走査を続ける
      i = j + 1;
      continue;
    }
    // 上記以外: 実マーカー。ラン中の最後の0xFF(j-1)がマーカーの開始位置
    return { entropyEnd: j - 1, nextMarkerPos: j - 1 };
  }
  throw new RemoveExifError(
    "missing-eoi",
    "エントロピー符号化データが切断されています(マーカーが見つかりません)",
  );
}

/**
 * JPEGバイナリからメタデータ領域を許可リスト方式で削除する。再エンコードは行わない。
 * 入力ArrayBufferは読み取り専用のビューとしてのみ扱い、変更しない。
 */
export function removeJpegMetadata(buffer: ArrayBuffer): JpegMetadataResult {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) {
    throw new RemoveExifError("invalid-jpeg", "ファイルが短すぎます");
  }
  if (bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new RemoveExifError("invalid-jpeg", "SOI(FFD8)ではありません");
  }

  const outputChunks: Uint8Array[] = [bytes.subarray(0, 2)];
  const removedRegions: RemovedRegion[] = [];
  const orientationValues = new Set<number>();
  let iccKept = false;
  let app0Index: number | null = null;

  function finalize(): JpegMetadataResult {
    if (orientationValues.size > 1) {
      throw new RemoveExifError(
        "ambiguous-orientation",
        "複数のExif APP1で異なるOrientation値が見つかりました",
      );
    }
    const orientationValue = orientationValues.size === 1 ? [...orientationValues][0] : null;
    const orientationKept = orientationValue !== null && orientationValue !== 1;

    if (orientationKept && orientationValue !== null) {
      const app1 = buildMinimalOrientationApp1(orientationValue);
      const insertAt = app0Index !== null ? app0Index + 1 : 1;
      outputChunks.splice(insertAt, 0, app1);
    }

    let totalLength = 0;
    for (const chunk of outputChunks) totalLength += chunk.length;
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of outputChunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      output: output.buffer,
      removedRegions,
      orientationKept,
      orientationValue: orientationKept ? orientationValue : null,
      iccKept,
    };
  }

  function handleAppSegment(
    marker: number,
    headerStart: number,
    payloadStart: number,
    payloadEnd: number,
  ): void {
    if (marker === 0xe0) {
      if (matchesId(bytes, payloadStart, payloadEnd, JFIF_ID)) {
        const rebuilt = buildMinimalJfifApp0(bytes, payloadStart, payloadEnd);
        if (payloadEnd - payloadStart > 14) removedRegions.push("app0-thumbnail");
        outputChunks.push(rebuilt);
        app0Index = outputChunks.length - 1;
        return;
      }
      if (matchesId(bytes, payloadStart, payloadEnd, JFXX_ID)) {
        removedRegions.push("app0-jfxx");
        return;
      }
      removedRegions.push("app0-unknown");
      return;
    }
    if (marker === 0xe1) {
      if (matchesId(bytes, payloadStart, payloadEnd, EXIF_ID)) {
        const values = readOrientationCandidates(bytes, payloadStart, payloadEnd);
        for (const value of values) orientationValues.add(value);
        removedRegions.push("app1-exif");
        return;
      }
      if (matchesId(bytes, payloadStart, payloadEnd, XMP_ID)) {
        removedRegions.push("app1-xmp");
        return;
      }
      removedRegions.push("app1-unknown");
      return;
    }
    if (marker === 0xe2) {
      if (isIccApp2(bytes, payloadStart, payloadEnd)) {
        outputChunks.push(bytes.subarray(headerStart, payloadEnd));
        iccKept = true;
        return;
      }
      removedRegions.push("app2-unknown");
      return;
    }
    if (marker === 0xed) {
      removedRegions.push("app13");
      return;
    }
    if (marker === 0xee) {
      if (matchesId(bytes, payloadStart, payloadEnd, ADOBE_ID)) {
        outputChunks.push(bytes.subarray(headerStart, payloadEnd));
        return;
      }
      removedRegions.push("app14-unknown");
      return;
    }
    if (marker === 0xef) {
      removedRegions.push("app15");
      return;
    }
    // APP3(0xE3)〜APP12(0xEC): 未知のAPPnとして常に削除
    removedRegions.push("app3-app12");
  }

  let pos = 2;
  let markerCount = 0;
  let scanCount = 0;

  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) {
      throw new RemoveExifError(
        "invalid-jpeg",
        `マーカー開始位置(0x${pos.toString(16)})が0xFFではありません`,
      );
    }
    let markerPos = pos;
    while (markerPos < bytes.length && bytes[markerPos] === 0xff) markerPos++;
    if (markerPos >= bytes.length) {
      throw new RemoveExifError("invalid-jpeg", "ファイル末尾でマーカーが切断されています");
    }
    const marker = bytes[markerPos];
    const headerStart = pos;
    pos = markerPos + 1;

    markerCount++;
    if (markerCount > MAX_MARKERS) {
      throw new RemoveExifError("limit-exceeded", "マーカー数が上限を超えています");
    }

    if (marker === EOI) {
      outputChunks.push(bytes.subarray(headerStart, pos));
      return finalize();
    }

    if (NO_LENGTH_MARKERS.has(marker)) {
      outputChunks.push(bytes.subarray(headerStart, pos));
      continue;
    }

    if (pos + 2 > bytes.length) {
      throw new RemoveExifError("invalid-segment-length", "セグメント長を読み取れません(末尾超過)");
    }
    const len = bytes[pos] * 256 + bytes[pos + 1];
    if (len < 2) {
      throw new RemoveExifError("invalid-segment-length", `不正なセグメント長です(${len} < 2)`);
    }
    const payloadStart = pos + 2;
    const payloadEnd = payloadStart + (len - 2);
    if (payloadEnd > bytes.length) {
      throw new RemoveExifError(
        "invalid-segment-length",
        "セグメント長がファイル末尾を超えています",
      );
    }

    if (marker === SOS) {
      scanCount++;
      if (scanCount > MAX_SCANS) {
        throw new RemoveExifError("limit-exceeded", "スキャン(SOS)数が上限を超えています");
      }
      // SOSヘッダ自体は他の構造的マーカーと同様そのまま維持する
      outputChunks.push(bytes.subarray(headerStart, payloadEnd));
      // 続くエントロピー符号化データは一切解析・変更せず、次の実マーカーの直前までを
      // 不透明なバイト列として維持する。プログレッシブJPEG等、複数のSOSが存在する場合も
      // 通常のマーカー解析ループへ戻ることで、スキャン間のAPPn/COMにも許可リストを適用する。
      const scanResult = consumeEntropyData(bytes, payloadEnd);
      outputChunks.push(bytes.subarray(payloadEnd, scanResult.entropyEnd));
      pos = scanResult.nextMarkerPos;
      continue;
    }

    if (marker >= 0xe0 && marker <= 0xef) {
      handleAppSegment(marker, headerStart, payloadStart, payloadEnd);
    } else if (marker === 0xfe) {
      removedRegions.push("com");
    } else {
      // SOF系/DQT/DHT/DRI/DNL/DAC等、表示に必須の構造的マーカーはそのまま維持する
      outputChunks.push(bytes.subarray(headerStart, payloadEnd));
    }

    pos = payloadEnd;
  }

  throw new RemoveExifError("missing-eoi", "EOIが見つからないまま終端しました");
}
