import { describe, expect, it } from "vitest";
import { detectApng } from "./apng-detection";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}
function chunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}
function ihdrData(width: number, height: number): number[] {
  return [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0];
}
function buildPng(chunks: number[][]): Uint8Array {
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]);
}

describe("detectApng", () => {
  it("acTLありはanimatedと判定する", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(100, 100)),
      chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]),
      chunk("IDAT", [1, 2]),
      chunk("IEND", []),
    ]);
    expect(detectApng(bytes)).toBe("animated");
  });

  it("acTLなしの通常PNGはstaticと判定する", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(800, 600)),
      chunk("IDAT", [1, 2, 3, 4]),
      chunk("IEND", []),
    ]);
    expect(detectApng(bytes)).toBe("static");
  });

  it("透過PNG相当(tRNSチャンクを含む)を誤検出しない", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(500, 500)),
      chunk("PLTE", [0, 0, 0, 255, 255, 255]),
      chunk("tRNS", [0, 255]),
      chunk("IDAT", [1, 2, 3]),
      chunk("IEND", []),
    ]);
    expect(detectApng(bytes)).toBe("static");
  });

  it("壊れた署名はnot-pngを返す", () => {
    expect(detectApng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe("not-png");
  });

  it("IHDRが無い(先頭チャンクがIHDR以外)場合はmalformed", () => {
    const bytes = buildPng([chunk("IDAT", [1, 2, 3]), chunk("IEND", [])]);
    expect(detectApng(bytes)).toBe("malformed");
  });

  it("チャンク長が不正な場合はmalformed", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(100, 100))]);
    const corrupted = new Uint8Array(bytes);
    corrupted[8] = 0x7f;
    corrupted[9] = 0xff;
    corrupted[10] = 0xff;
    corrupted[11] = 0xff;
    expect(detectApng(corrupted)).toBe("malformed");
  });

  it("切り詰められたファイルはmalformed", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(100, 100)), chunk("IDAT", [1, 2, 3, 4, 5])]);
    expect(detectApng(bytes.slice(0, bytes.length - 3))).toBe("malformed");
  });

  it("異常なチャンク数はmalformedとして安全に打ち切る", () => {
    const many: number[][] = [chunk("IHDR", ihdrData(10, 10))];
    for (let i = 0; i < 2000; i++) many.push(chunk("tEXt", []));
    const bytes = buildPng(many);
    expect(() => detectApng(bytes)).not.toThrow();
    expect(detectApng(bytes)).toBe("malformed");
  });

  it("安全上限境界: 非常に多いが上限未満のチャンク数は正しくstatic/animatedを判定できる", () => {
    const many: number[][] = [chunk("IHDR", ihdrData(10, 10))];
    for (let i = 0; i < 500; i++) many.push(chunk("tEXt", []));
    many.push(chunk("IEND", []));
    const bytes = buildPng(many);
    expect(detectApng(bytes)).toBe("static");
  });
});
