/**
 * HEIC→JPG変換後のダウンロードファイル名を、元のベース名を維持して`.jpg`拡張子で生成する。
 * 例: "IMG_1201.heic" -> "IMG_1201.jpg", "IMG_1201.HEIC" -> "IMG_1201.jpg"
 */
export function heicOutputFileName(originalFileName: string): string {
  const withoutExtension = originalFileName.replace(/\.[^./\\]+$/, "");
  const baseName = withoutExtension.length > 0 ? withoutExtension : originalFileName;
  return `${baseName}.jpg`;
}
