import { describe, expect, it } from "vitest";
import { isGlobalIndexingEnabled, resolveIsIndexable } from "./site-indexing";

describe("isGlobalIndexingEnabled", () => {
  it('厳密に文字列"true"の場合のみtrueを返す', () => {
    expect(isGlobalIndexingEnabled("true")).toBe(true);
  });

  it("未設定(undefined)の場合はfalse(安全側)", () => {
    expect(isGlobalIndexingEnabled(undefined)).toBe(false);
  });

  it('文字列"false"の場合はfalse', () => {
    expect(isGlobalIndexingEnabled("false")).toBe(false);
  });

  it("大文字小文字違いや紛らわしい値はfalse(誤って全体公開しない)", () => {
    expect(isGlobalIndexingEnabled("True")).toBe(false);
    expect(isGlobalIndexingEnabled("TRUE")).toBe(false);
    expect(isGlobalIndexingEnabled("1")).toBe(false);
    expect(isGlobalIndexingEnabled("")).toBe(false);
  });

  it("真偽値のtrue/falseが渡ってもfalse(想定する入力は文字列のみ)", () => {
    expect(isGlobalIndexingEnabled(true)).toBe(false);
    expect(isGlobalIndexingEnabled(false)).toBe(false);
  });
});

describe("resolveIsIndexable", () => {
  it("全体有効かつページ個別indexable=trueの場合のみtrue", () => {
    expect(resolveIsIndexable(true, true)).toBe(true);
  });

  it("全体が無効な場合はページ個別がtrueでもfalse", () => {
    expect(resolveIsIndexable(false, true)).toBe(false);
  });

  it("全体が有効でもページ個別がfalseならfalse", () => {
    expect(resolveIsIndexable(true, false)).toBe(false);
  });

  it("両方falseならfalse", () => {
    expect(resolveIsIndexable(false, false)).toBe(false);
  });
});
