/**
 * HEIC→JPG変換のquality固定値・入力サイズ上限。UIとheic-convert.worker.tsの両方から
 * 共通利用し、値がずれないようにする(png-to-webp-types.tsと同じ方針)。
 */

/** JPEG変換品質の固定値。将来的にURL別設定で変更可能にする拡張ポイント */
export const HEIC_JPEG_QUALITY = 0.8;

/**
 * Worker側でqualityを検証する。このツールではHEIC_JPEG_QUALITY以外は常に不正リクエストとして
 * 拒否する(1.0・0・負数・NaN・Infinity・任意の中間値等)。
 */
export function isAllowedHeicQuality(quality: number): boolean {
  return Number.isFinite(quality) && quality === HEIC_JPEG_QUALITY;
}

/**
 * HEIC入力ファイル(圧縮バイト列)のサイズ上限。arrayBuffer化・Worker送信前の入口制限として使う。
 * HEICはデコードするまで実際のピクセル寸法が分からないため、decode-safety.tsのDECODE_SAFETY_LIMITS
 * (デコード後のピクセル数上限)を置き換えるものではなく、それより手前の段階で追加でかける
 * 独立した安全弁である(両者は併用する)。
 */
export const MAX_HEIC_INPUT_BYTES = 50 * 1024 * 1024; // 50 MiB

export const HEIC_TOO_LARGE_MESSAGE =
  "HEICファイルのサイズが大きすぎるため処理できません(上限50MB)。";

export const HEIC_UNSUPPORTED_BROWSER_MESSAGE = "このブラウザではHEIC画像をJPGへ変換できません。";
