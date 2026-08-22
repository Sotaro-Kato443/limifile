import { describe, expect, it } from "vitest";
import {
  DEFAULT_RASTER_BACKGROUND,
  DEFAULT_RASTER_QUALITY_PRESET,
  RASTER_QUALITY_OPTIONS,
  backgroundColorToHex,
  computeSizeChange,
  hexToBackgroundColor,
  isAllowedRasterQuality,
  isValidRasterBackground,
  isValidRasterSourceFormat,
  qualityForRasterPreset,
} from "./raster-convert-types";

describe("RASTER_QUALITY_OPTIONS", () => {
  it("高画質・標準・軽量の3段階を提供する", () => {
    expect(RASTER_QUALITY_OPTIONS.map((o) => o.preset)).toEqual(["high", "standard", "light"]);
  });

  it("quality値は高画質0.90・標準0.80・軽量0.65である", () => {
    expect(qualityForRasterPreset("high")).toBe(0.9);
    expect(qualityForRasterPreset("standard")).toBe(0.8);
    expect(qualityForRasterPreset("light")).toBe(0.65);
  });

  it("いずれのpresetもquality 1.0を使わない", () => {
    for (const option of RASTER_QUALITY_OPTIONS) {
      expect(option.quality).toBeLessThan(1);
    }
  });

  it("既定のpresetはstandardである", () => {
    expect(DEFAULT_RASTER_QUALITY_PRESET).toBe("standard");
  });
});

describe("isAllowedRasterQuality", () => {
  it("0.65/0.80/0.90を許可する", () => {
    expect(isAllowedRasterQuality(0.65)).toBe(true);
    expect(isAllowedRasterQuality(0.8)).toBe(true);
    expect(isAllowedRasterQuality(0.9)).toBe(true);
  });

  it("1.0を許可しない", () => {
    expect(isAllowedRasterQuality(1.0)).toBe(false);
  });

  it("NaNを許可しない", () => {
    expect(isAllowedRasterQuality(NaN)).toBe(false);
  });

  it("Infinityを許可しない", () => {
    expect(isAllowedRasterQuality(Infinity)).toBe(false);
  });

  it("負数・0を許可しない", () => {
    expect(isAllowedRasterQuality(-0.5)).toBe(false);
    expect(isAllowedRasterQuality(0)).toBe(false);
  });

  it("許可された3値以外の任意の中間値を許可しない", () => {
    expect(isAllowedRasterQuality(0.75)).toBe(false);
  });
});

describe("DEFAULT_RASTER_BACKGROUND", () => {
  it("既定の背景色はwhite(255,255,255)である", () => {
    expect(DEFAULT_RASTER_BACKGROUND).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("backgroundColorToHex / hexToBackgroundColor", () => {
  it("whiteは#ffffffへ変換される", () => {
    expect(backgroundColorToHex(DEFAULT_RASTER_BACKGROUND)).toBe("#ffffff");
  });

  it("任意のRGBが#rrggbb形式へ変換される(1桁の値も0埋めされる)", () => {
    expect(backgroundColorToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(backgroundColorToHex({ r: 1, g: 2, b: 3 })).toBe("#010203");
    expect(backgroundColorToHex({ r: 255, g: 0, b: 128 })).toBe("#ff0080");
  });

  it("#rrggbb形式の文字列をRasterBackgroundColorへ変換する(往復変換で一致する)", () => {
    expect(hexToBackgroundColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToBackgroundColor("#010203")).toEqual({ r: 1, g: 2, b: 3 });
  });

  it("先頭#が無くても解析できる", () => {
    expect(hexToBackgroundColor("ff0080")).toEqual({ r: 255, g: 0, b: 128 });
  });

  it("大文字の16進数も解析できる", () => {
    expect(hexToBackgroundColor("#FF0080")).toEqual({ r: 255, g: 0, b: 128 });
  });

  it("不正な形式はnullを返す", () => {
    expect(hexToBackgroundColor("")).toBeNull();
    expect(hexToBackgroundColor("#fff")).toBeNull();
    expect(hexToBackgroundColor("not-a-color")).toBeNull();
    expect(hexToBackgroundColor("#gggggg")).toBeNull();
  });

  it("任意の色でtoHex→fromHexが往復して元の値と一致する", () => {
    for (const color of [
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
      { r: 128, g: 64, b: 32 },
    ]) {
      expect(hexToBackgroundColor(backgroundColorToHex(color))).toEqual(color);
    }
  });
});

describe("isValidRasterSourceFormat", () => {
  it("png・webp・avifを許可する", () => {
    expect(isValidRasterSourceFormat("png")).toBe(true);
    expect(isValidRasterSourceFormat("webp")).toBe(true);
    expect(isValidRasterSourceFormat("avif")).toBe(true);
  });

  it("png/webp/avif以外の文字列を許可しない", () => {
    expect(isValidRasterSourceFormat("jpeg")).toBe(false);
    expect(isValidRasterSourceFormat("heic")).toBe(false);
    expect(isValidRasterSourceFormat("gif")).toBe(false);
    expect(isValidRasterSourceFormat("")).toBe(false);
  });

  it("文字列以外(undefined/null/数値/オブジェクト)を許可しない", () => {
    expect(isValidRasterSourceFormat(undefined)).toBe(false);
    expect(isValidRasterSourceFormat(null)).toBe(false);
    expect(isValidRasterSourceFormat(1)).toBe(false);
    expect(isValidRasterSourceFormat({ value: "png" })).toBe(false);
  });
});

describe("isValidRasterBackground", () => {
  it("0-255の整数のr/g/bを許可する", () => {
    expect(isValidRasterBackground({ r: 0, g: 0, b: 0 })).toBe(true);
    expect(isValidRasterBackground({ r: 255, g: 255, b: 255 })).toBe(true);
    expect(isValidRasterBackground({ r: 10, g: 128, b: 250 })).toBe(true);
  });

  it("範囲外の値を許可しない", () => {
    expect(isValidRasterBackground({ r: -1, g: 0, b: 0 })).toBe(false);
    expect(isValidRasterBackground({ r: 256, g: 0, b: 0 })).toBe(false);
    expect(isValidRasterBackground({ r: 0, g: -1, b: 0 })).toBe(false);
    expect(isValidRasterBackground({ r: 0, g: 0, b: 256 })).toBe(false);
  });

  it("非整数(小数)を許可しない", () => {
    expect(isValidRasterBackground({ r: 1.5, g: 0, b: 0 })).toBe(false);
  });

  it("NaN/Infinityを許可しない", () => {
    expect(isValidRasterBackground({ r: NaN, g: 0, b: 0 })).toBe(false);
    expect(isValidRasterBackground({ r: 0, g: Infinity, b: 0 })).toBe(false);
  });
});

describe("computeSizeChange", () => {
  it("出力が入力より小さい場合はreducedとして正のパーセントを返す", () => {
    expect(computeSizeChange(1_000_000, 400_000)).toEqual({ direction: "reduced", percent: 60 });
  });

  it("出力が入力より大きい場合はincreasedとして正のパーセントを返す(マイナスにしない)", () => {
    expect(computeSizeChange(100_000, 125_000)).toEqual({ direction: "increased", percent: 25 });
  });

  it("同じサイズの場合はreducedの0%として自然に扱う", () => {
    expect(computeSizeChange(100_000, 100_000)).toEqual({ direction: "reduced", percent: 0 });
  });

  it("originalBytesが0の場合はreducedの0%を返す(ゼロ除算を避ける)", () => {
    expect(computeSizeChange(0, 100)).toEqual({ direction: "reduced", percent: 0 });
    expect(computeSizeChange(0, 0)).toEqual({ direction: "reduced", percent: 0 });
  });
});
