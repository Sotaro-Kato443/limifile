import { describe, expect, it } from "vitest";
import { compressOutputFileName } from "./compress-output-filename";

describe("compressOutputFileName", () => {
  it("拡張子を目標容量ラベル付きの.jpgへ置き換える", () => {
    expect(compressOutputFileName("photo.jpg", "500kb")).toBe("photo-500kb.jpg");
  });

  it("大文字拡張子やHEICも.jpgになる", () => {
    expect(compressOutputFileName("IMG_1201.HEIC", "1mb")).toBe("IMG_1201-1mb.jpg");
  });

  it("小数ラベル(1-5mb)もそのまま使われる", () => {
    expect(compressOutputFileName("photo.jpg", "1-5mb")).toBe("photo-1-5mb.jpg");
  });

  it("拡張子が無いファイル名でも元の名前を維持する", () => {
    expect(compressOutputFileName("photo", "500kb")).toBe("photo-500kb.jpg");
  });
});
