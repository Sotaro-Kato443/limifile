/**
 * 圧縮結果のダウンロードファイル名を、元のベース名+目標容量ラベルで生成する。
 * 例: ("photo.jpg", "500kb") -> "photo-500kb.jpg", ("IMG_1201.HEIC", "1mb") -> "IMG_1201-1mb.jpg"
 * 同名ファイルが複数あっても、内部のObject URL管理はファイル名ではなくアイテムIDで行うため衝突しない。
 */
export function compressOutputFileName(originalFileName: string, targetLabel: string): string {
  const withoutExtension = originalFileName.replace(/\.[^./\\]+$/, "");
  const baseName = withoutExtension.length > 0 ? withoutExtension : originalFileName;
  return `${baseName}-${targetLabel}.jpg`;
}
