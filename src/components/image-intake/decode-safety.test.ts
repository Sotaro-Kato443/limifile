import { describe, expect, it } from "vitest";
import {
  DECODE_SAFETY_LIMITS,
  dimensionsRoughlyMatch,
  validateDeclaredDimensions,
} from "./decode-safety";

describe("validateDeclaredDimensions", () => {
  it("正常な寸法はnull(エラー無し)を返す", () => {
    expect(validateDeclaredDimensions({ width: 4032, height: 3024 })).toBeNull();
  });

  it("寸法が取得できなかった場合はmissing-dimensions", () => {
    expect(validateDeclaredDimensions(null)).toBe("missing-dimensions");
  });

  it("width=0はinvalid-dimensions", () => {
    expect(validateDeclaredDimensions({ width: 0, height: 100 })).toBe("invalid-dimensions");
  });

  it("height=0はinvalid-dimensions", () => {
    expect(validateDeclaredDimensions({ width: 100, height: 0 })).toBe("invalid-dimensions");
  });

  it("負の寸法はinvalid-dimensions", () => {
    expect(validateDeclaredDimensions({ width: -1, height: 100 })).toBe("invalid-dimensions");
  });

  it("非整数の寸法はinvalid-dimensions", () => {
    expect(validateDeclaredDimensions({ width: 100.5, height: 100 })).toBe("invalid-dimensions");
  });

  it("最大辺を超える幅はdimension-too-large", () => {
    expect(
      validateDeclaredDimensions({ width: DECODE_SAFETY_LIMITS.maxDimension + 1, height: 100 }),
    ).toBe("dimension-too-large");
  });

  it("最大辺を超える高さはdimension-too-large", () => {
    expect(
      validateDeclaredDimensions({ width: 100, height: DECODE_SAFETY_LIMITS.maxDimension + 1 }),
    ).toBe("dimension-too-large");
  });

  it("辺は上限以下でも総ピクセル数が上限を超える場合はpixel-count-too-large", () => {
    // 16384 x 16384 は約2.68億pxで、maxPixels(67,108,864px)を超えるが、各辺はmaxDimension以下
    const side = DECODE_SAFETY_LIMITS.maxDimension;
    expect(validateDeclaredDimensions({ width: side, height: side })).toBe("pixel-count-too-large");
  });

  it("maxPixels(67,108,864)ちょうどは許可する", () => {
    // 8192 x 8192 = 67,108,864px ちょうど
    expect(validateDeclaredDimensions({ width: 8192, height: 8192 })).toBeNull();
  });

  it("maxPixels(67,108,864)を1pxでも超えると拒否する", () => {
    // 8192 x 8193 = 67,108,864 + 8192px、maxPixelsを超える
    expect(validateDeclaredDimensions({ width: 8192, height: 8193 })).toBe("pixel-count-too-large");
  });

  it("想定しているiPhoneパノラマ相当(約63.9MP)は許可する", () => {
    expect(validateDeclaredDimensions({ width: 12032, height: 5312 })).toBeNull();
  });

  it("width*heightのオーバーフロー相当の巨大な宣言値でも例外を投げず、辺の上限で先に弾く", () => {
    expect(() =>
      validateDeclaredDimensions({ width: 0xffffffff, height: 0xffffffff }),
    ).not.toThrow();
    expect(validateDeclaredDimensions({ width: 0xffffffff, height: 0xffffffff })).toBe(
      "dimension-too-large",
    );
  });

  it("カスタムのlimitsを指定できる", () => {
    expect(
      validateDeclaredDimensions(
        { width: 5000, height: 5000 },
        { maxDimension: 4000, maxPixels: 100_000_000 },
      ),
    ).toBe("dimension-too-large");
  });
});

describe("dimensionsRoughlyMatch", () => {
  it("宣言寸法と実寸法が一致する場合はtrue", () => {
    expect(dimensionsRoughlyMatch({ width: 800, height: 600 }, 800, 600)).toBe(true);
  });

  it("EXIF回転による幅高さの入れ替わりは一致とみなす", () => {
    expect(dimensionsRoughlyMatch({ width: 800, height: 600 }, 600, 800)).toBe(true);
  });

  it("全く異なる寸法は不一致とみなす", () => {
    expect(dimensionsRoughlyMatch({ width: 800, height: 600 }, 8000, 6000)).toBe(false);
  });
});
