/**
 * PNG指定容量圧縮結果のダウンロードファイル名を生成する。
 *
 * 拡張子の切り出しは既存の圧縮系ファイル名生成(compress-output-filename.ts・
 * png-to-webp-output-filename.ts等)と全く同じ正規表現 `/\.[^./\\]+$/` を再利用する
 * (大文字小文字を問わず最後の拡張子だけを置き換え、複数ドットを含むファイル名にも対応する)。
 * この正規表現は現時点で共有ヘルパー関数として切り出されておらず、機能ごとに同じ行が
 * 重複している(compress-output-filename.ts・png-to-webp-output-filename.ts・
 * heic-output-filename.ts・remove-exif-output-filename.ts)。今回のPNG機能でも独自の
 * サニタイズ仕様を新たに増やさず、既存と同一のロジックを踏襲した。3機能目以降で同じ処理が
 * 必要になった際は、共通ヘルパーへの切り出しを検討する価値がある。
 *
 * ファイル名の重複は、Object URL管理・ジョブ管理が常にアイテムID(ファイル名ではない)を
 * キーにしているため、この関数自体が重複対策を持つ必要はない。
 */
function baseNameOf(originalFileName: string): string {
  const withoutExtension = originalFileName.replace(/\.[^./\\]+$/, "");
  return withoutExtension.length > 0 ? withoutExtension : originalFileName;
}

/**
 * 通常成功(再エンコード・元ファイル返却のいずれも含む)時のファイル名。
 * 例: "example.png" -> "example-compressed.png", "photo.PNG" -> "photo-compressed.png",
 *     "photo" -> "photo-compressed.png", "my.photo.final.png" -> "my.photo.final-compressed.png"
 */
export function pngCompressionOutputFileName(originalFileName: string): string {
  return `${baseNameOf(originalFileName)}-compressed.png`;
}

/**
 * target未達だが最良候補(bestCandidate)を保存する場合のファイル名。
 * 例: "example.png" -> "example-minimized.png"
 */
export function pngCompressionMinimizedFileName(originalFileName: string): string {
  return `${baseNameOf(originalFileName)}-minimized.png`;
}
