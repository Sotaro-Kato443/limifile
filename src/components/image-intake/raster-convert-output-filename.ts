/**
 * PNG/WebP→JPG変換結果のダウンロードファイル名を、元のベース名を維持して.jpg拡張子で生成する。
 * 例: "photo.png" -> "photo.jpg", "photo.webp" -> "photo.jpg", "my.image.PNG" -> "my.image.jpg"
 * 拡張子は大文字小文字を問わず最後の1つだけを置き換える(複数ドットを含むファイル名にも対応)。
 * ファイル名の重複は、Object URL管理・ジョブ管理が常にアイテムID(ファイル名ではない)を
 * キーにしているため、この関数自体が重複対策を持つ必要はない(png-to-webp-output-filename.tsと同じ方針)。
 */
export function rasterToJpgOutputFileName(originalFileName: string): string {
  const withoutExtension = originalFileName.replace(/\.[^./\\]+$/, "");
  const baseName = withoutExtension.length > 0 ? withoutExtension : originalFileName;
  return `${baseName}.jpg`;
}
