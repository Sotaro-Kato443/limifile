/**
 * 画像一覧カードで使う、ユーザー向けの定型状態文言。
 * Worker・デコーダ等から返る技術的なエラーメッセージ(英語の例外文言等)をそのまま
 * 画面に出さないための固定文言。内部の詳細メッセージはDEV環境のデバッグ表示にのみ残す。
 */
export const HEIC_CONVERT_ERROR_MESSAGE =
  "この画像を変換できませんでした。別のファイルでお試しください。";
export const ANALYZE_ERROR_MESSAGE =
  "この画像を解析できませんでした。別のファイルでお試しください。";
export const UNSUPPORTED_FORMAT_MESSAGE =
  "未対応の形式です(JPG/PNG/WebP/HEIC・HEIFのみ解析できます。AVIF等は今後対応予定です)";
