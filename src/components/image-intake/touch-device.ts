/**
 * タッチ端末(スマートフォン・タブレット等)かどうかを、UA文字列を使わず機能・入力方式ベースで判定する。
 * matchMediaが存在しない環境(一部のテスト環境や古いブラウザ)でも例外にならないようにする。
 */
export function isTouchDevice(): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.maxTouchPoints === "number") {
    if (navigator.maxTouchPoints > 0) return true;
  }

  if (typeof matchMedia === "function") {
    try {
      return matchMedia("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  }

  return false;
}
