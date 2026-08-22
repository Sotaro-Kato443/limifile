/**
 * PNG→WebP変換結果のダウンロードファイル名を、元のベース名を維持して.webp拡張子で生成する。
 * 例: "photo.png" -> "photo.webp", "my.image.PNG" -> "my.image.webp"
 * 拡張子は大文字小文字を問わず最後の1つだけを置き換える(複数ドットを含むファイル名にも対応)。
 * ファイル名の重複は、Object URL管理・ジョブ管理が常にアイテムID(ファイル名ではない)を
 * キーにしているため、この関数自体が重複対策を持つ必要はない。
 */
export function pngToWebpOutputFileName(originalFileName: string): string {
  const withoutExtension = originalFileName.replace(/\.[^./\\]+$/, "");
  const baseName = withoutExtension.length > 0 ? withoutExtension : originalFileName;
  return `${baseName}.webp`;
}
