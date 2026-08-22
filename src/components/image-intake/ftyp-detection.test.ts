import { describe, expect, it } from "vitest";
import { classifyIsobmff, parseFtypBox } from "./ftyp-detection";

function buildFtypBytes(majorBrand: string, compatibleBrands: string[] = []): Uint8Array {
  const totalSize = 16 + compatibleBrands.length * 4;
  const bytes = new Uint8Array(totalSize);
  bytes[0] = (totalSize >>> 24) & 0xff;
  bytes[1] = (totalSize >>> 16) & 0xff;
  bytes[2] = (totalSize >>> 8) & 0xff;
  bytes[3] = totalSize & 0xff;
  "ftyp".split("").forEach((c, i) => (bytes[4 + i] = c.charCodeAt(0)));
  majorBrand.split("").forEach((c, i) => (bytes[8 + i] = c.charCodeAt(0)));
  compatibleBrands.forEach((brand, brandIndex) => {
    brand.split("").forEach((c, i) => (bytes[16 + brandIndex * 4 + i] = c.charCodeAt(0)));
  });
  return bytes;
}

describe("parseFtypBox", () => {
  it("正常なftypボックス(iPhone標準HEIC相当)を解析できる", () => {
    const bytes = buildFtypBytes("heic", ["mif1", "heic", "heix", "hevc"]);
    const result = parseFtypBox(bytes);
    expect(result).toEqual({
      majorBrand: "heic",
      minorVersion: 0,
      compatibleBrands: ["mif1", "heic", "heix", "hevc"],
    });
  });

  it("短すぎるバッファはnullを返す(例外を投げない)", () => {
    expect(parseFtypBox(new Uint8Array([0, 0, 0, 0]))).toBeNull();
    expect(parseFtypBox(new Uint8Array(0))).toBeNull();
  });

  it("ftyp以外のボックスタイプはnullを返す", () => {
    const bytes = buildFtypBytes("isom", ["iso2", "mp41"]);
    bytes[4] = "m".charCodeAt(0);
    bytes[5] = "o".charCodeAt(0);
    bytes[6] = "o".charCodeAt(0);
    bytes[7] = "v".charCodeAt(0);
    expect(parseFtypBox(bytes)).toBeNull();
  });

  it("宣言サイズがヘッダより小さい不正な値でもnullを返す(例外を投げない)", () => {
    const bytes = buildFtypBytes("heic", ["mif1"]);
    // 宣言サイズを2(major_brand/minor_versionすら入らない不正値)に書き換える
    bytes[0] = 0;
    bytes[1] = 0;
    bytes[2] = 0;
    bytes[3] = 2;
    expect(parseFtypBox(bytes)).toBeNull();
  });

  it("宣言サイズが実バッファ長より大きくても範囲外読み取りせず、読める範囲でcompatible_brandsを解析する", () => {
    const bytes = buildFtypBytes("heic", ["mif1", "heix"]);
    // 宣言サイズを実際のバッファ長より大きい値に書き換える(壊れたファイルを想定)
    const oversizedDeclaredSize = bytes.length + 100;
    bytes[0] = (oversizedDeclaredSize >>> 24) & 0xff;
    bytes[1] = (oversizedDeclaredSize >>> 16) & 0xff;
    bytes[2] = (oversizedDeclaredSize >>> 8) & 0xff;
    bytes[3] = oversizedDeclaredSize & 0xff;

    const result = parseFtypBox(bytes);
    expect(result).not.toBeNull();
    expect(result?.majorBrand).toBe("heic");
    expect(result?.compatibleBrands).toEqual(["mif1", "heix"]);
  });

  it("宣言サイズ0(ファイル末尾まで)を安全に扱う", () => {
    const bytes = buildFtypBytes("heic", ["mif1"]);
    bytes[0] = 0;
    bytes[1] = 0;
    bytes[2] = 0;
    bytes[3] = 0;
    const result = parseFtypBox(bytes);
    expect(result?.majorBrand).toBe("heic");
    expect(result?.compatibleBrands).toEqual(["mif1"]);
  });

  it("largesize(宣言サイズ1)を安全に扱う", () => {
    const bytes = new Uint8Array(24);
    bytes[3] = 1; // size = 1 (largesize)
    "ftyp".split("").forEach((c, i) => (bytes[4 + i] = c.charCodeAt(0)));
    // largesize本体(8バイト、offset 8-15) = 24
    bytes[15] = 24;
    "heic".split("").forEach((c, i) => (bytes[16 + i] = c.charCodeAt(0)));
    const result = parseFtypBox(bytes);
    expect(result?.majorBrand).toBe("heic");
  });
});

describe("classifyIsobmff", () => {
  it("HEIC系ブランド(major=heic)をheicと判定する", () => {
    const ftyp = parseFtypBox(buildFtypBytes("heic", ["mif1", "heix", "hevc"]))!;
    expect(classifyIsobmff(ftyp)).toBe("heic");
  });

  it("HEIF系ブランド(major=heix)をheicと判定する", () => {
    const ftyp = parseFtypBox(buildFtypBytes("heix", ["mif1"]))!;
    expect(classifyIsobmff(ftyp)).toBe("heic");
  });

  it("HEIFバーストシーケンス相当(major=msf1, compatibleにhevc)をheicと判定する", () => {
    const ftyp = parseFtypBox(buildFtypBytes("msf1", ["mif1", "hevc"]))!;
    expect(classifyIsobmff(ftyp)).toBe("heic");
  });

  it("AVIF(major=avif)をheicとして誤認しない", () => {
    const ftyp = parseFtypBox(buildFtypBytes("avif", ["mif1", "miaf"]))!;
    expect(classifyIsobmff(ftyp)).toBe("avif");
  });

  it("AVIFアニメーション(major=avis)をheicとして誤認しない", () => {
    const ftyp = parseFtypBox(buildFtypBytes("avis", ["avif", "msf1"]))!;
    expect(classifyIsobmff(ftyp)).toBe("avif");
  });

  it("HEIC系ブランドとAVIF系ブランドが同居する場合はAVIF判定を優先する", () => {
    const ftyp = parseFtypBox(buildFtypBytes("avif", ["mif1", "heic"]))!;
    expect(classifyIsobmff(ftyp)).toBe("avif");
  });

  it("mif1単独ではHEICと断定しない", () => {
    const ftyp = parseFtypBox(buildFtypBytes("mif1", []))!;
    expect(classifyIsobmff(ftyp)).toBe("unknown");
  });

  it("msf1単独ではHEICと断定しない", () => {
    const ftyp = parseFtypBox(buildFtypBytes("msf1", ["mif1"]))!;
    expect(classifyIsobmff(ftyp)).toBe("unknown");
  });

  it("無関係なftyp(MP4系)はunknownと判定する", () => {
    const ftyp = parseFtypBox(buildFtypBytes("isom", ["iso2", "mp41"]))!;
    expect(classifyIsobmff(ftyp)).toBe("unknown");
  });
});
