import { afterEach, describe, expect, it, vi } from "vitest";
import { isTouchDevice } from "./touch-device";

function setMaxTouchPoints(value: number): void {
  Object.defineProperty(navigator, "maxTouchPoints", {
    value,
    configurable: true,
  });
}

describe("isTouchDevice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // biome-ignore-line: navigator.maxTouchPointsはjsdomの標準プロパティではなくテストで追加したもの
    delete (navigator as unknown as { maxTouchPoints?: unknown }).maxTouchPoints;
  });

  it("navigator.maxTouchPoints > 0の場合はtrue", () => {
    setMaxTouchPoints(5);
    expect(isTouchDevice()).toBe(true);
  });

  it("navigator.maxTouchPoints === 0で、matchMedia(pointer: coarse)がfalseの場合はfalse", () => {
    setMaxTouchPoints(0);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false }) as MediaQueryList),
    );
    expect(isTouchDevice()).toBe(false);
  });

  it("navigator.maxTouchPoints === 0でも、matchMedia(pointer: coarse)がtrueならtrue", () => {
    setMaxTouchPoints(0);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );
    expect(isTouchDevice()).toBe(true);
  });

  it("matchMediaが存在しない環境でも例外にならない(falseを返す)", () => {
    setMaxTouchPoints(0);
    vi.stubGlobal("matchMedia", undefined);
    expect(() => isTouchDevice()).not.toThrow();
    expect(isTouchDevice()).toBe(false);
  });

  it("matchMedia自体が例外を投げる場合でも安全側(false)に倒れる", () => {
    setMaxTouchPoints(0);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => {
        throw new Error("boom");
      }),
    );
    expect(() => isTouchDevice()).not.toThrow();
    expect(isTouchDevice()).toBe(false);
  });
});
