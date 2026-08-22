import { readWebpChunks } from "./webp-riff";

export type WebpAnimationCheck = "animated" | "static" | "not-webp" | "malformed";

/** VP8Xフラグバイトのbit1。libwebpのANIM_FLAG(1<<1)定義に準拠する */
const VP8X_ANIMATION_FLAG_BIT = 0x02;

/**
 * WebPのRIFF構造を走査し、アニメーションWebPかどうかを判定する。
 * VP8XのAnimationフラグ、またはANIM/ANMFチャンクの存在のいずれかを検出した場合は"animated"を返す。
 * 先頭フレームだけを取り出して静止画として扱うことは行わない(呼び出し側でそのまま圧縮対象外にする)。
 *
 * RIFFコンテナ自体の妥当性検証(全体サイズ・末尾の一致・チャンク範囲・パディング等)はwebp-riff.tsが担う。
 * 壊れたRIFFサイズ・チャンク長の範囲外・整数オーバーフロー・不正なパディングに対しても
 * 例外を投げず、"malformed"として安全に扱う。WebPと判定できないバイト列は"not-webp"を返す。
 */
export function detectWebpAnimation(bytes: Uint8Array): WebpAnimationCheck {
  const chunks = readWebpChunks(bytes);
  if (chunks === "not-webp") return "not-webp";
  if (chunks === "malformed") return "malformed";

  for (const { fourCC, payloadStart, payloadEnd } of chunks) {
    if (fourCC === "ANIM" || fourCC === "ANMF") return "animated";

    if (fourCC === "VP8X") {
      if (payloadEnd - payloadStart < 1) return "malformed";
      const flags = bytes[payloadStart];
      if ((flags & VP8X_ANIMATION_FLAG_BIT) !== 0) return "animated";
    }
  }

  return "static";
}
