import { describe, expect, it } from "vitest";
import { compressWebpOutputFileName } from "./compress-webp-output-filename";

describe("compressWebpOutputFileName", () => {
  it("拡張子を固定の-compressed.webpへ置き換える", () => {
    expect(compressWebpOutputFileName("photo.webp")).toBe("photo-compressed.webp");
  });

  it("大文字拡張子でも.webpになる", () => {
    expect(compressWebpOutputFileName("PHOTO.WEBP")).toBe("PHOTO-compressed.webp");
  });

  it("拡張子が無いファイル名でも元の名前を維持する", () => {
    expect(compressWebpOutputFileName("photo")).toBe("photo-compressed.webp");
  });

  it("ファイル名にドットを複数含む場合も最後の拡張子だけを置き換える", () => {
    expect(compressWebpOutputFileName("my.photo.webp")).toBe("my.photo-compressed.webp");
  });
});
