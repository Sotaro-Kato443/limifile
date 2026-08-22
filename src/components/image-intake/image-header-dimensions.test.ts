import { describe, expect, it } from "vitest";
import { readDeclaredDimensions } from "./image-header-dimensions";

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}

function buildJpeg(width: number, height: number, extra: number[] = []): Uint8Array {
  const sof0Payload = [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0];
  const bytes = [
    0xff,
    0xd8, // SOI
    0xff,
    0xc0, // SOF0
    ...u16be(sof0Payload.length + 2),
    ...sof0Payload,
    ...extra,
    0xff,
    0xd9, // EOI
  ];
  return new Uint8Array(bytes);
}

function buildPng(width: number, height: number): Uint8Array {
  const bytes = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // signature
    ...u32be(13), // IHDR length
    ...ascii("IHDR"),
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0, // bit depth/color type/compression/filter/interlace
    0,
    0,
    0,
    0, // CRC (not validated by parser)
  ];
  return new Uint8Array(bytes);
}

function riffHeader(payloadLength: number): number[] {
  return [...ascii("RIFF"), ...u32le(4 + payloadLength), ...ascii("WEBP")];
}

/** RIFFチャンク1つ分(fourCC+size+payload)を組み立てる。奇数長payloadには必須のpaddingバイト(0)を付与する */
function webpChunk(fourCC: string, payload: number[]): number[] {
  const padding = payload.length % 2 === 1 ? [0] : [];
  return [...ascii(fourCC), ...u32le(payload.length), ...payload, ...padding];
}

function buildWebpVp8x(width: number, height: number): Uint8Array {
  const vp8xPayload = [
    0x00, // flags
    0,
    0,
    0, // reserved
    ...u24le(width - 1),
    ...u24le(height - 1),
  ];
  const chunk = webpChunk("VP8X", vp8xPayload);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

function buildWebpVp8Simple(width: number, height: number): Uint8Array {
  const vp8Payload = [
    0x10,
    0x00,
    0x00, // frame tag (unchecked by parser)
    0x9d,
    0x01,
    0x2a, // start code
    ...u16le(width & 0x3fff),
    ...u16le(height & 0x3fff),
  ];
  const chunk = webpChunk("VP8 ", vp8Payload);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

function buildWebpVp8L(width: number, height: number): Uint8Array {
  const widthMinus1 = width - 1;
  const heightMinus1 = height - 1;
  const packed = ((widthMinus1 & 0x3fff) | ((heightMinus1 & 0x3fff) << 14)) >>> 0;
  const vp8lPayload = [0x2f, ...u32le(packed)];
  const chunk = webpChunk("VP8L", vp8lPayload);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

describe("readDeclaredDimensions", () => {
  it("JPEGのSOF0マーカーからwidth/heightを読み取る", () => {
    expect(readDeclaredDimensions(buildJpeg(1024, 768), "jpeg")).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("JPEGでDHT等のSOF以外のC系マーカーを挟んでもSOFを正しく読み取る", () => {
    // DHT(0xC4)は長さ2バイトのペイロードとして処理し、その次のSOFへ到達できることを確認する
    const dht = [0xff, 0xc4, 0x00, 0x02];
    const bytes = buildJpeg(640, 480, []);
    // buildJpegはSOFの直後にDHTを挟めないため、ここではSOF前にDHTがある構成を別途組み立てる
    const withDht = new Uint8Array([0xff, 0xd8, ...dht, ...bytes.slice(2)]);
    expect(readDeclaredDimensions(withDht, "jpeg")).toEqual({ width: 640, height: 480 });
  });

  it("PNGのIHDRチャンクからwidth/heightを読み取る", () => {
    expect(readDeclaredDimensions(buildPng(800, 600), "png")).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("WebP VP8X(拡張ヘッダー)のcanvasサイズを読み取る", () => {
    expect(readDeclaredDimensions(buildWebpVp8x(400, 300), "webp")).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("WebP VP8(単純形式・非可逆)のビットストリームからwidth/heightを読み取る", () => {
    expect(readDeclaredDimensions(buildWebpVp8Simple(320, 240), "webp")).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("WebP VP8L(単純形式・可逆)のビットストリームからwidth/heightを読み取る", () => {
    expect(readDeclaredDimensions(buildWebpVp8L(100, 50), "webp")).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("0幅・0高さのJPEGはそのまま{width:0,...}等として返す(値の妥当性はdecode-safety側で検証する)", () => {
    expect(readDeclaredDimensions(buildJpeg(0, 100), "jpeg")).toEqual({ width: 0, height: 100 });
  });

  it("切り詰められたJPEGはnullを返す", () => {
    const full = buildJpeg(1024, 768);
    expect(readDeclaredDimensions(full.slice(0, 6), "jpeg")).toBeNull();
  });

  it("切り詰められたPNGはnullを返す", () => {
    const full = buildPng(800, 600);
    expect(readDeclaredDimensions(full.slice(0, 16), "png")).toBeNull();
  });

  it("切り詰められたWebPはnullを返す", () => {
    const full = buildWebpVp8x(400, 300);
    expect(readDeclaredDimensions(full.slice(0, 14), "webp")).toBeNull();
  });

  it("WebPのチャンク長がファイル範囲外の場合はnullを返す(壊れたチャンク長)", () => {
    const bytes = buildWebpVp8x(400, 300);
    // VP8Xチャンクのsizeフィールド(offset16-19)を実際のバッファ長を超える値へ壊す
    const corrupted = new Uint8Array(bytes);
    corrupted[16] = 0xff;
    corrupted[17] = 0xff;
    corrupted[18] = 0xff;
    corrupted[19] = 0x7f;
    expect(readDeclaredDimensions(corrupted, "webp")).toBeNull();
  });

  it("WebPのチャンクサイズが極端な値(整数オーバーフロー相当)でも例外を投げずnullを返す", () => {
    const bytes = buildWebpVp8x(400, 300);
    const corrupted = new Uint8Array(bytes);
    corrupted[16] = 0xff;
    corrupted[17] = 0xff;
    corrupted[18] = 0xff;
    corrupted[19] = 0xff; // 0xFFFFFFFF
    expect(() => readDeclaredDimensions(corrupted, "webp")).not.toThrow();
    expect(readDeclaredDimensions(corrupted, "webp")).toBeNull();
  });

  it("RIFF/WEBPシグネチャが無いバイト列はnullを返す", () => {
    expect(
      readDeclaredDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "webp"),
    ).toBeNull();
  });

  it("空バイト列はどの形式でもnullを返す", () => {
    const empty = new Uint8Array([]);
    expect(readDeclaredDimensions(empty, "jpeg")).toBeNull();
    expect(readDeclaredDimensions(empty, "png")).toBeNull();
    expect(readDeclaredDimensions(empty, "webp")).toBeNull();
  });

  it("HEICは対象外としてnullを返す", () => {
    expect(readDeclaredDimensions(new Uint8Array(32), "heic")).toBeNull();
  });

  it("AVIFも対象外としてnullを返す(寸法候補はavif-isobmff.tsのreadAvifIspeCandidatesが別途扱う)", () => {
    expect(readDeclaredDimensions(new Uint8Array(32), "avif")).toBeNull();
  });
});
