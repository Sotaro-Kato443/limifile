/**
 * AVIF→JPG変換の入力サイズ上限。heic-conversion-types.tsのMAX_HEIC_INPUT_BYTESと同じ理由・
 * 同じ値を採用する: pre-decode safety(avif-isobmff.tsのispe候補検証)のためにfile.arrayBuffer()で
 * 圧縮ファイル全体をメモリへ読み込む必要があり、その読み込み自体が先にメモリを消費してしまわないよう、
 * 寸法ゲートより手前にかける入口制限である。decode-safety.tsのDECODE_SAFETY_LIMITS(デコード後の
 * ピクセル数上限)を置き換えるものではなく、それより手前の段階で追加でかける独立した安全弁として
 * 両者を併用する。
 *
 * 「アップロード制限」ではない(このツールはファイルをアップロードしない)。ローカルブラウザ処理の
 * メモリ安全上限として、intake側(use-image-intake.ts)とWorker側(raster-convert.worker.ts、
 * 最終的な安全境界)の両方で検証する。
 */
export const MAX_AVIF_INPUT_BYTES = 50 * 1024 * 1024; // 50 MiB

export const AVIF_TOO_LARGE_MESSAGE =
  "AVIFファイルのサイズが大きすぎるため安全に処理できません(上限50MB)。";
