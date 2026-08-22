/**
 * PNG(89 50 4e 47 0d 0a 1a 0a シグネチャ)の共通チャンク走査。
 * apng-detection.ts(acTL検出)から利用する、PNG構造そのものの妥当性検証を1箇所に集約する。
 * image-header-dimensions.tsのIHDR読み取りは固定オフセット読み取りのみで完結するため、
 * こちらの汎用チャンク走査には依存しない(互いに独立)。
 */

export interface PngChunk {
  type: string;
  /** チャンクデータの開始位置 */
  dataStart: number;
  /** チャンクデータの終了位置(この位置を含まない。CRCフィールドは含まない) */
  dataEnd: number;
}

/** "not-png": PNG署名自体が一致しない。"malformed": 署名はあるが構造が壊れている */
export type PngChunkError = "not-png" | "malformed";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/**
 * 異常に多いチャンクを持つファイルの走査を打ち切るための安全上限。
 * PNGはIDATが数KB単位の小チャンクへ分割されるのが一般的なエンコーダの標準的な挙動であり
 * (例: 4096byte/IDATの場合、50MiB相当の入力で1万数千チャンクに達する)、
 * webp-riff.tsのMAX_CHUNKS_TO_SCAN(RIFF/WebPは通常チャンク数が少ない)をそのまま流用すると、
 * 正当な大きめのPNGを誤ってmalformed判定してしまう。そのため独立した、PNG向けに十分な値を設定する。
 */
const MAX_CHUNKS_TO_SCAN = 100_000;

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/**
 * PNGのチャンク列を検証しながら読み取る。
 *
 * 検証内容:
 * - PNG署名(8byte)の一致(不一致は"not-png")
 * - 先頭チャンクがIHDRであること(PNG仕様上、IHDRは常に署名直後の最初のチャンク)
 * - IHDRのlengthは必ず13(PNG仕様で固定長と定められている)
 * - IHDRは1回のみ(2個目以降のIHDRはmalformed)
 * - 各チャンクは length(4, big-endian) + type(4) + data(length) + CRC(4) の構造を持つとして走査し、
 *   チャンクヘッダー(length+type=8byte)を読み切れない場合はmalformed
 * - dataEnd・chunkEndはNumber.isSafeIntegerであること、かつ必ず現在位置(offset)より後ろへ進むこと
 *   (lengthは常に非負のため理論上は自明だが、明示的に保証する)
 * - チャンクのdata+CRCがファイル範囲を超える場合はmalformed(整数オーバーフロー相当の
 *   巨大なlength値も、この範囲チェックにより安全側で拒否される。CRC自体の値は検証しないが、
 *   CRC用4byteがファイル範囲内に実在することは確認する)
 * - IENDは必ず存在し、lengthは必ず0で、そのchunkEndがbytes.lengthと完全一致すること
 *   (IEND前にファイルが終了している、IEND後に余分なデータや別チャンクが続く、
 *   IENDのCRCが切り詰められている、のいずれもmalformedとして拒否する。IEND以降のチャンクを
 *   黙って無視することはしない)
 * - 異常に多いチャンク数(MAX_CHUNKS_TO_SCAN超過)はmalformedとして安全に打ち切る
 */
export function readPngChunks(bytes: Uint8Array): PngChunk[] | PngChunkError {
  if (bytes.length < PNG_SIGNATURE.length) return "not-png";
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return "not-png";
  }

  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let sawIhdr = false;
  let sawIend = false;

  while (offset < bytes.length) {
    chunkCount++;
    if (chunkCount > MAX_CHUNKS_TO_SCAN) return "malformed";
    if (offset + 8 > bytes.length) return "malformed"; // length+typeの8byteすら読み切れない

    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (chunks.length === 0 && type !== "IHDR") return "malformed"; // IHDRが先頭チャンクではない

    if (type === "IHDR") {
      if (sawIhdr) return "malformed"; // IHDRは1回のみ
      if (length !== 13) return "malformed"; // IHDRのlengthは必ず13
      sawIhdr = true;
    }
    if (type === "IEND" && length !== 0) return "malformed"; // IENDのlengthは必ず0

    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4; // CRCフィールド分
    if (!Number.isSafeInteger(dataEnd) || !Number.isSafeInteger(chunkEnd)) return "malformed";
    if (chunkEnd <= offset) return "malformed"; // 進行不能な不正チャンク(無限ループ防止)
    if (chunkEnd > bytes.length) return "malformed"; // data+CRCがファイル範囲外

    chunks.push({ type, dataStart, dataEnd });

    if (type === "IEND") {
      sawIend = true;
      if (chunkEnd !== bytes.length) return "malformed"; // IEND後に余分なデータ・別チャンクがある
      break;
    }
    offset = chunkEnd;
  }

  if (chunks.length === 0) return "malformed"; // IHDRを含む最低1チャンクも読めなかった
  if (!sawIend) return "malformed"; // IENDが存在しないまま終端した(IHDRだけで終了、等)
  return chunks;
}
