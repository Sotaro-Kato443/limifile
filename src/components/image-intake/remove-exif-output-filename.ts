/**
 * メタデータ削除後のダウンロードファイル名を、元のベース名を維持して生成する。
 * HEIC由来の場合も、変換後の内部ファイル名ではなく元のベース名を使う。
 * 例: "IMG_1201.jpg" -> "IMG_1201-metadata-removed.jpg", "IMG_1201.HEIC" -> "IMG_1201-metadata-removed.jpg"
 */
export function removeExifOutputFileName(originalFileName: string): string {
  const withoutExtension = originalFileName.replace(/\.[^./\\]+$/, "");
  const baseName = withoutExtension.length > 0 ? withoutExtension : originalFileName;
  return `${baseName}-metadata-removed.jpg`;
}
