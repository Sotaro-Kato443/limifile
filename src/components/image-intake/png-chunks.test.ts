import { describe, expect, it } from "vitest";
import { readPngChunks } from "./png-chunks";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}

/** 長さ・タイプ・データ・ダミーCRC(4byte、値は未検証なので0固定)を持つ1チャンク分を組み立てる */
function chunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

function ihdrData(width: number, height: number): number[] {
  return [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0];
}

function buildPng(chunks: number[][]): Uint8Array {
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]);
}

describe("readPngChunks", () => {
  it("通常PNG(IHDR+IDAT+IEND)を正しく読み取る", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(800, 600)),
      chunk("IDAT", [1, 2, 3, 4]),
      chunk("IEND", []),
    ]);
    const result = readPngChunks(bytes);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    }
  });

  it("acTLを含むAPNGでもチャンク列を正しく読み取る(判定自体はapng-detection.tsが担う)", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(100, 100)),
      chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]),
      chunk("IDAT", [1, 2]),
      chunk("IEND", []),
    ]);
    const result = readPngChunks(bytes);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result.map((c) => c.type)).toContain("acTL");
    }
  });

  it("PNG署名が無い場合はnot-pngを返す", () => {
    expect(readPngChunks(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe("not-png");
  });

  it("署名だけで中身が全く無い場合はmalformed", () => {
    expect(readPngChunks(new Uint8Array(PNG_SIGNATURE))).toBe("malformed");
  });

  it("先頭チャンクがIHDRではない場合はmalformed", () => {
    const bytes = buildPng([chunk("IDAT", [1, 2, 3]), chunk("IEND", [])]);
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("チャンク長がファイル範囲外の場合はmalformed", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(100, 100))]);
    const corrupted = new Uint8Array(bytes);
    // IHDRチャンクのlengthフィールド(署名直後の4byte)を実際のファイルより大きい値へ壊す
    corrupted[8] = 0x7f;
    corrupted[9] = 0xff;
    corrupted[10] = 0xff;
    corrupted[11] = 0xff;
    expect(readPngChunks(corrupted)).toBe("malformed");
  });

  it("チャンク長が整数オーバーフロー相当の巨大値でも例外を投げずmalformedを返す", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(100, 100))]);
    const corrupted = new Uint8Array(bytes);
    corrupted[8] = 0xff;
    corrupted[9] = 0xff;
    corrupted[10] = 0xff;
    corrupted[11] = 0xff; // length = 0xFFFFFFFF
    expect(() => readPngChunks(corrupted)).not.toThrow();
    expect(readPngChunks(corrupted)).toBe("malformed");
  });

  it("末尾に不完全なチャンクヘッダーが残る場合はmalformed", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(100, 100))]);
    // 8byte未満の断片を追加(length+typeの8byteを読み切れない)
    const truncatedTrailing = new Uint8Array([...bytes, 0, 0, 0]);
    expect(readPngChunks(truncatedTrailing)).toBe("malformed");
  });

  it("CRCフィールド分もファイル範囲に含めて検証する(data直後で切り詰められている場合はmalformed)", () => {
    // IHDRのdataまではあるが、CRC4byteが足りない状態を作る
    const ihdr = ihdrData(100, 100);
    const withoutCrc = new Uint8Array([
      ...PNG_SIGNATURE,
      ...u32be(ihdr.length),
      ...ascii("IHDR"),
      ...ihdr,
      // CRC無し
    ]);
    expect(readPngChunks(withoutCrc)).toBe("malformed");
  });

  it("異常に多いチャンク数はmalformedとして安全に打ち切る", () => {
    // MAX_CHUNKS_TO_SCAN(100,000)を超える数のチャンクを用意する。IENDを含めないことで、
    // 上限に達する前にIEND欠如で先にmalformed判定されてしまわないようにする。
    // 配列spreadの組み立て(buildPng/chunkヘルパー)は10万件超では低速なため、
    // ここだけ事前確保したUint8Arrayへ直接書き込む高速な構築にする。
    const ihdr = chunk("IHDR", ihdrData(10, 10));
    const chunkCount = 100_001;
    const bytes = new Uint8Array(PNG_SIGNATURE.length + ihdr.length + chunkCount * 12);
    bytes.set(PNG_SIGNATURE, 0);
    bytes.set(ihdr, PNG_SIGNATURE.length);
    let offset = PNG_SIGNATURE.length + ihdr.length;
    const textType = ascii("tEXt");
    for (let i = 0; i < chunkCount; i++) {
      // length=0
      bytes.set(textType, offset + 4);
      offset += 12; // length(4) + type(4) + data(0) + crc(4)
    }
    expect(() => readPngChunks(bytes)).not.toThrow();
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("実際のPNGエンコーダが生成する多数の小IDATチャンク(数千〜1万強)は上限超過として拒否しない", () => {
    // 例: 4096byte/IDATのチャンク化を行うエンコーダで数十MBの画像を圧縮した場合を想定。
    // 以前はwebp-riff.ts由来の1024という上限を流用しており、正当な大きめのPNGを
    // 誤ってmalformed判定してしまっていた(実ブラウザでの検証で発見した回帰)。
    const many: number[][] = [chunk("IHDR", ihdrData(1600, 1200))];
    for (let i = 0; i < 1610; i++) {
      many.push(chunk("IDAT", new Array(16).fill(0)));
    }
    many.push(chunk("IEND", []));
    const bytes = buildPng(many);
    const result = readPngChunks(bytes);
    expect(Array.isArray(result)).toBe(true);
  });

  it("IEND後に別チャンクが続く場合は無視せずmalformed", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(10, 10)),
      chunk("IEND", []),
      chunk("tEXt", [1, 2, 3]), // IEND以降は無視せずmalformedとして拒否する
    ]);
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("IHDRのlengthが13以外の場合はmalformed", () => {
    const bytes = buildPng([
      chunk("IHDR", [...ihdrData(10, 10), 0]), // length=14
      chunk("IEND", []),
    ]);
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("IHDRが複数回出現する場合はmalformed", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(10, 10)),
      chunk("IHDR", ihdrData(10, 10)),
      chunk("IEND", []),
    ]);
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("IENDが存在しない場合はmalformed", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(10, 10)), chunk("IDAT", [1, 2, 3])]);
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("IENDのlengthが0以外の場合はmalformed", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(10, 10)), chunk("IEND", [0, 0, 0, 0])]);
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("IEND後に1byteでも余分なデータがあればmalformed", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(10, 10)), chunk("IEND", [])]);
    const withTrailingByte = new Uint8Array([...bytes, 0]);
    expect(readPngChunks(withTrailingByte)).toBe("malformed");
  });

  it("IHDRだけでファイルが終了している場合(IENDが無い)はmalformed", () => {
    const bytes = buildPng([chunk("IHDR", ihdrData(10, 10))]);
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("IENDのCRCが切り詰められている場合はmalformed", () => {
    const ihdr = ihdrData(10, 10);
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...u32be(ihdr.length),
      ...ascii("IHDR"),
      ...ihdr,
      0,
      0,
      0,
      0, // IHDRのCRC
      ...u32be(0),
      ...ascii("IEND"),
      // IENDのCRC4byteが無い
    ]);
    expect(readPngChunks(bytes)).toBe("malformed");
  });

  it("正常なPNGはIEND終端がファイル末尾と完全一致し配列を返す", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(800, 600)),
      chunk("IDAT", [1, 2, 3, 4]),
      chunk("IEND", []),
    ]);
    const result = readPngChunks(bytes);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    }
  });

  it("正常なAPNGはIEND終端がファイル末尾と完全一致し配列を返す", () => {
    const bytes = buildPng([
      chunk("IHDR", ihdrData(100, 100)),
      chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]),
      chunk("IDAT", [1, 2]),
      chunk("IEND", []),
    ]);
    const result = readPngChunks(bytes);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result.map((c) => c.type)).toEqual(["IHDR", "acTL", "IDAT", "IEND"]);
    }
  });
});
