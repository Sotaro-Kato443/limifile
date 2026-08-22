/**
 * WebP(RIFF/WEBPコンテナ)の共通検証・チャンク走査。
 * image-header-dimensions.ts(寸法解析)とwebp-animation-detection.ts(アニメーション判定)の
 * 両方から利用する、RIFF構造そのものの妥当性検証を1箇所に集約する。
 */

export interface WebpChunk {
  fourCC: string;
  /** チャンクのペイロード開始位置(フォーサCC+サイズフィールドの直後) */
  payloadStart: number;
  /** チャンクのペイロード終了位置(この位置を含まない) */
  payloadEnd: number;
}

/** "not-webp": RIFF/WEBPシグネチャ自体が一致しない。"malformed": シグネチャはあるが構造が壊れている */
export type WebpRiffError = "not-webp" | "malformed";

const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
/** 異常に多いチャンクを持つファイルの走査を打ち切るための安全上限 */
const MAX_CHUNKS_TO_SCAN = 1024;

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/**
 * WebPのRIFFコンテナ全体を検証し、有効なチャンク列を返す。
 *
 * 検証内容:
 * - RIFF/WEBPシグネチャの一致(不一致は"not-webp")
 * - RIFFヘッダーのsize(オフセット4〜7、little-endian uint32)からriffEnd(=8+riffSize)を算出し、
 *   riffSizeが4未満(WEBPフォーサCC自体すら含められない)ならmalformed
 * - riffEndがNumberの安全な整数範囲内であることを確認(仕様上32bit値なので実際には常に安全域内だが、
 *   後続の比較を無条件に信頼しないための明示的な防御)
 * - riffEndがbytes.lengthと厳密に一致すること(riffEndが短い=末尾に余分なデータがある、
 *   riffEndが長い=ファイルが途中で切り詰められている、のいずれも拒否する)
 * - チャンク走査はbytes.lengthではなく必ずriffEnd(コンテナが自己申告する終端)を上限に行う
 * - 走査中、次のチャンクヘッダー(fourCC 4byte + size 4byte = 8byte)を読み切れない
 *   (riffEnd手前に1〜7byteだけ残っている)場合はmalformed
 * - 各チャンクのペイロードがriffEndを超える場合はmalformed
 * - チャンクサイズが奇数の場合の1byteパディングも、riffEndの範囲内に実在することを確認する
 *   (パディング分を含めた次のオフセットがriffEndを超える場合はmalformed)
 */
export function readWebpChunks(bytes: Uint8Array): WebpChunk[] | WebpRiffError {
  if (bytes.length < 12) return "not-webp";
  for (let i = 0; i < RIFF_SIGNATURE.length; i++) {
    if (bytes[i] !== RIFF_SIGNATURE[i]) return "not-webp";
  }
  for (let i = 0; i < WEBP_SIGNATURE.length; i++) {
    if (bytes[8 + i] !== WEBP_SIGNATURE[i]) return "not-webp";
  }

  const riffSize = readUint32LE(bytes, 4);
  if (riffSize < 4) return "malformed";

  const riffEnd = 8 + riffSize;
  if (!Number.isSafeInteger(riffEnd)) return "malformed";
  if (riffEnd !== bytes.length) return "malformed";

  const chunks: WebpChunk[] = [];
  let offset = 12;
  let chunkCount = 0;

  while (offset < riffEnd) {
    chunkCount++;
    if (chunkCount > MAX_CHUNKS_TO_SCAN) return "malformed";
    if (offset + 8 > riffEnd) return "malformed"; // 末尾に1〜7byte残る不完全なチャンクヘッダー

    const fourCC = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const chunkSize = readUint32LE(bytes, offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + chunkSize;
    if (payloadEnd > riffEnd) return "malformed";

    chunks.push({ fourCC, payloadStart, payloadEnd });

    const hasPadding = chunkSize % 2 === 1;
    if (hasPadding && payloadEnd >= riffEnd) return "malformed"; // paddingバイトを置く余地がない
    const nextOffset = payloadEnd + (hasPadding ? 1 : 0);
    if (nextOffset <= offset) return "malformed"; // 進行不能な不正チャンク(無限ループ防止)
    offset = nextOffset;
  }

  return chunks;
}
