/**
 * target-fit変換結果のダウンロードファイル名を、元のベース名を維持して.jpg拡張子で生成する。
 * raster-convert-output-filename.tsのrasterToJpgOutputFileNameと同じ方針(ファイル名の重複対策は
 * 持たない。Object URL管理・ジョブ管理は常にアイテムIDをキーにしているため)。
 */
export function targetFitOutputFileName(originalFileName: string): string {
  const withoutExtension = originalFileName.replace(/\.[^./\\]+$/, "");
  const baseName = withoutExtension.length > 0 ? withoutExtension : originalFileName;
  return `${baseName}.jpg`;
}
