import { describe, expect, it } from "vitest";
import { readWebpChunks } from "./webp-riff";

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}

/** riffSizeを明示的に指定できるRIFFヘッダー(通常のヘルパーは常に正しいサイズを計算するため、
 * 意図的に不正な値を作るテストではこちらを使う) */
function riffHeaderWithSize(riffSize: number): number[] {
  return [...ascii("RIFF"), ...u32le(riffSize), ...ascii("WEBP")];
}

function webpChunk(fourCC: string, payload: number[]): number[] {
  const padding = payload.length % 2 === 1 ? [0] : [];
  return [...ascii(fourCC), ...u32le(payload.length), ...payload, ...padding];
}

function validVp8xChunk(): number[] {
  return webpChunk("VP8X", [0, 0, 0, 0, 99, 0, 0, 99, 0, 0]); // 10byte(偶数)、flags/reserved/width-1/height-1
}

describe("readWebpChunks", () => {
  it("正しいriffSizeの静止WebPはチャンク配列を返す", () => {
    const chunk = validVp8xChunk();
    const riffSize = 4 + chunk.length;
    const bytes = new Uint8Array([...riffHeaderWithSize(riffSize), ...chunk]);
    const result = readWebpChunks(bytes);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result).toHaveLength(1);
      expect(result[0].fourCC).toBe("VP8X");
    }
  });

  it("RIFFサイズが実ファイルより小さい(riffEndが末尾より手前=余分なデータがある)場合はmalformed", () => {
    const chunk = validVp8xChunk();
    const correctRiffSize = 4 + chunk.length;
    const bytes = new Uint8Array([
      ...riffHeaderWithSize(correctRiffSize - 4), // 実際より4byte小さく宣言する
      ...chunk,
    ]);
    expect(readWebpChunks(bytes)).toBe("malformed");
  });

  it("RIFFサイズが実ファイルより大きい(riffEndが末尾を超える=切り詰め)場合はmalformed", () => {
    const chunk = validVp8xChunk();
    const correctRiffSize = 4 + chunk.length;
    const bytes = new Uint8Array([
      ...riffHeaderWithSize(correctRiffSize + 8), // 実際より8byte大きく宣言する(切り詰められている体)
      ...chunk,
    ]);
    expect(readWebpChunks(bytes)).toBe("malformed");
  });

  it("RIFFサイズが4未満はmalformed(WEBPフォーサCC自体すら含められない)", () => {
    const bytes = new Uint8Array([...riffHeaderWithSize(3), ...ascii("WEBX")]);
    expect(readWebpChunks(bytes)).toBe("malformed");
  });

  it("RIFF終端後に余分なデータがある場合は拒否する", () => {
    const chunk = validVp8xChunk();
    const correctRiffSize = 4 + chunk.length;
    const bytes = new Uint8Array([
      ...riffHeaderWithSize(correctRiffSize),
      ...chunk,
      1,
      2,
      3,
      4, // RIFF終端より後ろの余分なバイト列
    ]);
    expect(readWebpChunks(bytes)).toBe("malformed");
  });

  it("末尾に1〜7バイトの不完全なチャンクヘッダーが残る場合はmalformed", () => {
    const chunk = validVp8xChunk();
    const incompleteHeader = [...ascii("AB"), 0, 0, 0]; // 5byte(8byte未満)の不完全なヘッダー
    const trailingLength = incompleteHeader.length;
    const riffSize = 4 + chunk.length + trailingLength;
    const bytes = new Uint8Array([...riffHeaderWithSize(riffSize), ...chunk, ...incompleteHeader]);
    expect(readWebpChunks(bytes)).toBe("malformed");
  });

  it("奇数長チャンクのpaddingバイトが欠損している(コンテナ範囲内に存在しない)場合はmalformed", () => {
    // VP8Lのペイロード5byte(奇数)だが、paddingバイトを付与せずriffSizeもそれに合わせて宣言する
    const vp8lPayload = [0x2f, 1, 2, 3, 4];
    const chunkWithoutPadding = [...ascii("VP8L"), ...u32le(vp8lPayload.length), ...vp8lPayload];
    const riffSize = 4 + chunkWithoutPadding.length;
    const bytes = new Uint8Array([...riffHeaderWithSize(riffSize), ...chunkWithoutPadding]);
    expect(readWebpChunks(bytes)).toBe("malformed");
  });

  it("奇数長チャンクのpaddingバイトがコンテナ範囲内に正しく存在する場合は許可する", () => {
    const vp8lPayload = [0x2f, 1, 2, 3, 4]; // 5byte(奇数)
    const chunk = webpChunk("VP8L", vp8lPayload); // paddingバイトを自動付与
    const riffSize = 4 + chunk.length;
    const bytes = new Uint8Array([...riffHeaderWithSize(riffSize), ...chunk]);
    const result = readWebpChunks(bytes);
    expect(Array.isArray(result)).toBe(true);
  });

  it("チャンクサイズが整数オーバーフロー相当の巨大値でも例外を投げずmalformedを返す", () => {
    const bytes = new Uint8Array([
      ...riffHeaderWithSize(1000),
      ...ascii("VP8X"),
      0xff,
      0xff,
      0xff,
      0xff, // chunkSize = 0xFFFFFFFF
    ]);
    expect(() => readWebpChunks(bytes)).not.toThrow();
    expect(readWebpChunks(bytes)).toBe("malformed");
  });

  it("RIFF/WEBPシグネチャが無い場合はnot-webp", () => {
    expect(readWebpChunks(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe(
      "not-webp",
    );
  });

  it("12byte未満はnot-webp", () => {
    expect(readWebpChunks(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe("not-webp");
  });
});
