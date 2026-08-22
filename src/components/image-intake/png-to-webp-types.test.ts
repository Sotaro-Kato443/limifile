import { describe, expect, it } from "vitest";
import {
  DEFAULT_PNG_TO_WEBP_QUALITY_PRESET,
  PNG_TO_WEBP_QUALITY_OPTIONS,
  isAllowedQuality,
  qualityForPreset,
} from "./png-to-webp-types";

describe("PNG_TO_WEBP_QUALITY_OPTIONS", () => {
  it("高画質・標準・軽量の3段階を提供する", () => {
    expect(PNG_TO_WEBP_QUALITY_OPTIONS.map((o) => o.preset)).toEqual(["high", "standard", "light"]);
  });

  it("quality値は高画質0.90・標準0.80・軽量0.65である", () => {
    expect(qualityForPreset("high")).toBe(0.9);
    expect(qualityForPreset("standard")).toBe(0.8);
    expect(qualityForPreset("light")).toBe(0.65);
  });

  it("いずれのpresetもquality 1.0を使わない", () => {
    for (const option of PNG_TO_WEBP_QUALITY_OPTIONS) {
      expect(option.quality).toBeLessThan(1);
    }
  });

  it("各presetはlabel・descriptionを持つ", () => {
    for (const option of PNG_TO_WEBP_QUALITY_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  it("既定のpresetはstandardである", () => {
    expect(DEFAULT_PNG_TO_WEBP_QUALITY_PRESET).toBe("standard");
  });
});

describe("isAllowedQuality", () => {
  it("0.65/0.80/0.90を許可する", () => {
    expect(isAllowedQuality(0.65)).toBe(true);
    expect(isAllowedQuality(0.8)).toBe(true);
    expect(isAllowedQuality(0.9)).toBe(true);
  });

  it("1.0を許可しない", () => {
    expect(isAllowedQuality(1.0)).toBe(false);
  });

  it("NaNを許可しない", () => {
    expect(isAllowedQuality(NaN)).toBe(false);
  });

  it("Infinityを許可しない", () => {
    expect(isAllowedQuality(Infinity)).toBe(false);
  });

  it("負数・0を許可しない", () => {
    expect(isAllowedQuality(-0.5)).toBe(false);
    expect(isAllowedQuality(0)).toBe(false);
  });

  it("0.98を超える値を許可しない", () => {
    expect(isAllowedQuality(0.99)).toBe(false);
  });

  it("許可された3値以外の任意の中間値を許可しない", () => {
    expect(isAllowedQuality(0.75)).toBe(false);
  });
});
