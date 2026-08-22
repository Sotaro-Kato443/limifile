import { readPngChunks } from "./png-chunks";

export type ApngCheck = "animated" | "static" | "not-png" | "malformed";

/**
 * PNGのチャンク列を走査し、アニメーションPNG(APNG)かどうかを判定する。
 * acTLチャンクの存在を検出した場合は"animated"を返す(先頭フレームだけを取り出して
 * 静止画として扱うことは行わない。呼び出し側でそのまま変換対象外にする)。
 *
 * PNGコンテナ自体の妥当性検証(署名・IHDR先頭・チャンク範囲・異常なチャンク数等)はpng-chunks.tsが担う。
 * 壊れたPNG構造に対しても例外を投げず、"malformed"として安全に扱う。
 * PNGと判定できないバイト列は"not-png"を返す。
 */
export function detectApng(bytes: Uint8Array): ApngCheck {
  const chunks = readPngChunks(bytes);
  if (chunks === "not-png") return "not-png";
  if (chunks === "malformed") return "malformed";

  for (const { type } of chunks) {
    if (type === "acTL") return "animated";
  }

  return "static";
}
