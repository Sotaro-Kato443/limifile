/**
 * WebP圧縮結果のダウンロードファイル名を、元のベース名+固定の"-compressed"接尾辞+.webp拡張子で生成する。
 * JPEG/HEIC出力(compress-output-filename.ts)とは異なり目標容量ラベルは使わない(仕様上の指定)。
 * 例: "photo.webp" -> "photo-compressed.webp"
 */
export function compressWebpOutputFileName(originalFileName: string): string {
  const withoutExtension = originalFileName.replace(/\.[^./\\]+$/, "");
  const baseName = withoutExtension.length > 0 ? withoutExtension : originalFileName;
  return `${baseName}-compressed.webp`;
}
