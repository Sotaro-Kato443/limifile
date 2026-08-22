import { describe, expect, it } from "vitest";
import {
  MAX_TARGET_BYTES,
  MIN_TARGET_BYTES,
  parseTargetSizeInput,
  TARGET_SIZE_PRESETS,
  toCompressionTarget,
  validateTargetSize,
} from "./compression-target";

describe("compression-target: バイト単位変換(10進基準)", () => {
  it("1KBは1,000バイト", () => {
    expect(toCompressionTarget(1, "KB").bytes).toBe(1000);
  });

  it("1MBは1,000,000バイト", () => {
    expect(toCompressionTarget(1, "MB").bytes).toBe(1_000_000);
  });

  it("500KBは500,000バイト", () => {
    expect(toCompressionTarget(500, "KB").bytes).toBe(500_000);
  });

  it("小数入力(1.5MB)も正しくバイト変換される", () => {
    expect(toCompressionTarget(1.5, "MB").bytes).toBe(1_500_000);
  });

  it("表示文字列とファイル名ラベルを生成する", () => {
    const target = toCompressionTarget(500, "KB");
    expect(target.displayText).toBe("500KB");
    expect(target.label).toBe("500kb");
  });

  it("小数値のラベルはドットをハイフンに置き換える", () => {
    const target = toCompressionTarget(1.5, "MB");
    expect(target.label).toBe("1-5mb");
  });

  it.each([
    [20, 20_000, "20KB", "20kb"],
    [50, 50_000, "50KB", "50kb"],
    [100, 100_000, "100KB", "100kb"],
    [200, 200_000, "200KB", "200kb"],
    [500, 500_000, "500KB", "500kb"],
  ] as const)(
    "固定容量ページ用: %sKBはbytes=%s・displayText=%s・label=%sになる",
    (kb, bytes, displayText, label) => {
      const target = toCompressionTarget(kb, "KB");
      expect(target.bytes).toBe(bytes);
      expect(target.displayText).toBe(displayText);
      expect(target.label).toBe(label);
    },
  );
});

describe("compression-target: 入力検証", () => {
  it("0はエラー(not-positive)", () => {
    expect(validateTargetSize(0, "KB")).toBe("not-positive");
  });

  it("負数はエラー(not-positive)", () => {
    expect(validateTargetSize(-100, "KB")).toBe("not-positive");
  });

  it("NaNはエラー(invalid-number)", () => {
    expect(validateTargetSize(Number.NaN, "KB")).toBe("invalid-number");
  });

  it("最小値(10KB)未満はエラー(too-small)", () => {
    expect(validateTargetSize(9, "KB")).toBe("too-small");
  });

  it("最小値(10KB)ちょうどはエラーにならない", () => {
    expect(validateTargetSize(10, "KB")).toBeNull();
  });

  it("最大値(50MB)を超えるとエラー(too-large)", () => {
    expect(validateTargetSize(51, "MB")).toBe("too-large");
  });

  it("最大値(50MB)ちょうどはエラーにならない", () => {
    expect(validateTargetSize(50, "MB")).toBeNull();
  });

  it("最小値・最大値の定数がドキュメント通り(10KB・50MB)", () => {
    expect(MIN_TARGET_BYTES).toBe(10_000);
    expect(MAX_TARGET_BYTES).toBe(50_000_000);
  });
});

describe("compression-target: 生入力文字列のパース", () => {
  it("空欄はエラー(empty)", () => {
    const result = parseTargetSizeInput("", "KB");
    expect(result).toEqual({ ok: false, error: "empty" });
  });

  it("空白のみもエラー(empty)", () => {
    const result = parseTargetSizeInput("   ", "KB");
    expect(result).toEqual({ ok: false, error: "empty" });
  });

  it("数値文字列を正しく解釈する", () => {
    const result = parseTargetSizeInput("500", "KB");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.bytes).toBe(500_000);
    }
  });

  it("小数入力を許可する", () => {
    const result = parseTargetSizeInput("1.5", "MB");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.bytes).toBe(1_500_000);
    }
  });

  it("数値でない文字列はエラー(invalid-number)", () => {
    const result = parseTargetSizeInput("abc", "KB");
    expect(result).toEqual({ ok: false, error: "invalid-number" });
  });

  it("0はエラー(not-positive)", () => {
    const result = parseTargetSizeInput("0", "KB");
    expect(result).toEqual({ ok: false, error: "not-positive" });
  });

  it("負数はエラー(not-positive)", () => {
    const result = parseTargetSizeInput("-5", "KB");
    expect(result).toEqual({ ok: false, error: "not-positive" });
  });
});

describe("compression-target: プリセット", () => {
  it("100KB/200KB/500KB/1MB/2MBの5件が定義されている", () => {
    expect(TARGET_SIZE_PRESETS).toHaveLength(5);
    expect(TARGET_SIZE_PRESETS.map((p) => p.label)).toEqual([
      "100KB",
      "200KB",
      "500KB",
      "1MB",
      "2MB",
    ]);
  });

  it("500KBプリセットは500,000バイトに変換される", () => {
    const preset = TARGET_SIZE_PRESETS.find((p) => p.label === "500KB")!;
    expect(toCompressionTarget(preset.value, preset.unit).bytes).toBe(500_000);
  });
});
