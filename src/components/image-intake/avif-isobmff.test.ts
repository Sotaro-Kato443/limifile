import { describe, expect, it } from "vitest";
import { hasAvisBrand, readAvifIspeCandidates } from "./avif-isobmff";
import type { AvifDimensionCandidate } from "./avif-isobmff";

/**
 * 合成バイト列を組み立てるための最小限のボックスビルダー。
 * ftyp-detection.test.tsのbuildFtypBytesと同じ方針(手でbyte配列を組む)を、
 * ネストしたボックス構造(meta > iprp > ipco > ispe)に拡張したもの。
 */
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii4(type: string): number[] {
  return type.split("").map((c) => c.charCodeAt(0));
}

/** 通常ヘッダ(32bit size + 4byte type) + payloadを持つボックスを1つ組み立てる */
function box(type: string, payload: number[]): number[] {
  const totalSize = 8 + payload.length;
  return [...u32be(totalSize), ...ascii4(type), ...payload];
}

/** largesize形式(size=1 + 4byte type + 64bit largesize) + payloadを持つボックス */
function largesizeBox(type: string, payload: number[]): number[] {
  const totalSize = 16 + payload.length;
  // 64bit largesizeの上位32bitは常に0(テストで扱う値は32bitに収まる)とする
  return [...u32be(1), ...ascii4(type), ...u32be(0), ...u32be(totalSize), ...payload];
}

/** size=0(「ファイル/レベル末尾まで」を意味する)ボックス。必ず各レベルの最後に置く */
function toEndBox(type: string, payload: number[]): number[] {
  return [...u32be(0), ...ascii4(type), ...payload];
}

/** ispeボックス(FullBox 4byte + width 4byte + height 4byte)のpayload */
function ispePayload(width: number, height: number): number[] {
  return [...u32be(0), ...u32be(width), ...u32be(height)];
}

/** meta(FullBox)のpayloadは version+flags(4byte) の後に子ボックス列が続く */
function metaPayload(children: number[]): number[] {
  return [...u32be(0), ...children];
}

function bytesOf(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** meta > iprp > ipco > ispe(複数可)という、最も一般的な形のAVIF構造を組み立てる */
function buildAvifWithIspeCandidates(candidates: AvifDimensionCandidate[]): Uint8Array {
  const ispeBoxes = candidates.flatMap((c) => box("ispe", ispePayload(c.width, c.height)));
  const ipco = box("ipco", ispeBoxes);
  const iprp = box("iprp", ipco);
  const meta = box("meta", metaPayload(iprp));
  return bytesOf(meta);
}

describe("readAvifIspeCandidates", () => {
  it("meta > iprp > ipco > ispeの単一候補を読み取れる", () => {
    const bytes = buildAvifWithIspeCandidates([{ width: 1920, height: 1080 }]);
    expect(readAvifIspeCandidates(bytes)).toEqual([{ width: 1920, height: 1080 }]);
  });

  it("ipco直下に複数のispeがある場合、全て候補として返す(補助画像等)", () => {
    const bytes = buildAvifWithIspeCandidates([
      { width: 4032, height: 3024 },
      { width: 320, height: 240 }, // サムネイル相当の小さいispe
    ]);
    expect(readAvifIspeCandidates(bytes)).toEqual([
      { width: 4032, height: 3024 },
      { width: 320, height: 240 },
    ]);
  });

  it("極端な縦長・横長を持つ複数ispeでも、それぞれ個別の候補としてそのまま返す(合成しない)", () => {
    // width/heightの最大値同士を合成すると実在しない16000x16000が生まれてしまうため、
    // このテストは「合成せず個別に保持する」という設計の直接的な検証を兼ねる。
    const bytes = buildAvifWithIspeCandidates([
      { width: 16000, height: 1000 },
      { width: 1000, height: 16000 },
    ]);
    expect(readAvifIspeCandidates(bytes)).toEqual([
      { width: 16000, height: 1000 },
      { width: 1000, height: 16000 },
    ]);
  });

  it("largesize形式のmetaボックスでも解析できる", () => {
    const ispeBoxes = box("ispe", ispePayload(800, 600));
    const ipco = box("ipco", ispeBoxes);
    const iprp = box("iprp", ipco);
    const meta = largesizeBox("meta", metaPayload(iprp));
    expect(readAvifIspeCandidates(bytesOf(meta))).toEqual([{ width: 800, height: 600 }]);
  });

  it("size=0(終端まで)形式のispeボックスでも解析できる", () => {
    const ispe = toEndBox("ispe", ispePayload(640, 480));
    const ipco = box("ipco", ispe);
    const iprp = box("iprp", ipco);
    const meta = box("meta", metaPayload(iprp));
    expect(readAvifIspeCandidates(bytesOf(meta))).toEqual([{ width: 640, height: 480 }]);
  });

  it("mdat等、meta以外のトップレベルボックスが先行していても、metaを見つけて解析する", () => {
    const mdat = box("mdat", [1, 2, 3, 4]);
    const ispe = box("ispe", ispePayload(1024, 768));
    const ipco = box("ipco", ispe);
    const iprp = box("iprp", ipco);
    const meta = box("meta", metaPayload(iprp));
    const bytes = bytesOf([...mdat, ...meta]);
    expect(readAvifIspeCandidates(bytes)).toEqual([{ width: 1024, height: 768 }]);
  });

  it("metaボックスが無い場合は空配列を返す(例外を投げない)", () => {
    const mdat = box("mdat", [1, 2, 3, 4]);
    expect(readAvifIspeCandidates(bytesOf(mdat))).toEqual([]);
  });

  it("iprpが無い場合は空配列を返す", () => {
    const meta = box("meta", metaPayload(box("free", [])));
    expect(readAvifIspeCandidates(bytesOf(meta))).toEqual([]);
  });

  it("ipcoが無い場合は空配列を返す", () => {
    const iprp = box("iprp", box("free", []));
    const meta = box("meta", metaPayload(iprp));
    expect(readAvifIspeCandidates(bytesOf(meta))).toEqual([]);
  });

  it("ipco内にispeが1つも無い場合は空配列を返す", () => {
    const ipco = box("ipco", box("pixi", [1, 2, 3]));
    const iprp = box("iprp", ipco);
    const meta = box("meta", metaPayload(iprp));
    expect(readAvifIspeCandidates(bytesOf(meta))).toEqual([]);
  });

  it("空バッファ・極端に短いバッファでも空配列を返す(例外を投げない)", () => {
    expect(readAvifIspeCandidates(new Uint8Array(0))).toEqual([]);
    expect(readAvifIspeCandidates(new Uint8Array([0, 0, 0]))).toEqual([]);
  });

  it("宣言サイズがヘッダ自体より小さい不正なmetaボックスは無視する", () => {
    const bytes = bytesOf([...u32be(4), ...ascii4("meta"), 1, 2, 3, 4]);
    expect(readAvifIspeCandidates(bytes)).toEqual([]);
  });

  it("宣言サイズがバッファ長を超える不正なmetaボックスは無視する(範囲外読み取りしない)", () => {
    const meta = box(
      "meta",
      metaPayload(box("iprp", box("ipco", box("ispe", ispePayload(100, 100))))),
    );
    // 宣言サイズを実バッファ長より大きく書き換える
    const oversized = [...meta];
    const oversizedSize = meta.length + 1000;
    oversized[0] = (oversizedSize >>> 24) & 0xff;
    oversized[1] = (oversizedSize >>> 16) & 0xff;
    oversized[2] = (oversizedSize >>> 8) & 0xff;
    oversized[3] = oversizedSize & 0xff;
    expect(readAvifIspeCandidates(bytesOf(oversized))).toEqual([]);
  });

  it("ボックスが後退・自己参照するオフセットになる場合はスキャンを打ち切る(無限ループにしない)", () => {
    // totalSize(8) < headerSize相当になるよう、sizeを不正に小さい値(4)にする
    const malformedIspe = bytesOf([...u32be(4), ...ascii4("ispe"), ...ispePayload(1, 1)]);
    const ipco = box("ipco", Array.from(malformedIspe));
    const iprp = box("iprp", ipco);
    const meta = box("meta", metaPayload(iprp));
    expect(readAvifIspeCandidates(bytesOf(meta))).toEqual([]);
  });

  it("largesizeのヘッダ自体が短すぎる(totalSize<16)場合は無視する", () => {
    const malformedLargesize = bytesOf([...u32be(1), ...ascii4("meta"), ...u32be(0), ...u32be(10)]);
    expect(readAvifIspeCandidates(malformedLargesize)).toEqual([]);
  });
});

describe("hasAvisBrand", () => {
  it("avisブランドが含まれる場合はtrueを返す", () => {
    expect(hasAvisBrand(["avif", "avis", "mif1"])).toBe(true);
  });

  it("avisブランドが含まれない場合はfalseを返す", () => {
    expect(hasAvisBrand(["avif", "mif1", "miaf"])).toBe(false);
  });

  it("空配列ではfalseを返す", () => {
    expect(hasAvisBrand([])).toBe(false);
  });
});
