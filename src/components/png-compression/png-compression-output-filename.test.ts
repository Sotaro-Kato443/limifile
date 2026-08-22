import { describe, expect, it } from "vitest";
import {
  pngCompressionMinimizedFileName,
  pngCompressionOutputFileName,
} from "./png-compression-output-filename";

describe("pngCompressionOutputFileName", () => {
  it("拡張子の前に-compressedを付加する", () => {
    expect(pngCompressionOutputFileName("example.png")).toBe("example-compressed.png");
  });

  it("大文字拡張子でも.pngへ正規化される", () => {
    expect(pngCompressionOutputFileName("photo.PNG")).toBe("photo-compressed.png");
  });

  it("拡張子が無いファイル名でも元の名前を維持する", () => {
    expect(pngCompressionOutputFileName("photo")).toBe("photo-compressed.png");
  });

  it("複数ドットを含むファイル名は最後の拡張子だけを置き換える", () => {
    expect(pngCompressionOutputFileName("my.photo.final.png")).toBe(
      "my.photo.final-compressed.png",
    );
  });

  it("空白や記号を含むファイル名でも動作する", () => {
    expect(pngCompressionOutputFileName("my photo (1).png")).toBe("my photo (1)-compressed.png");
  });
});

describe("pngCompressionMinimizedFileName", () => {
  it("拡張子の前に-minimizedを付加する", () => {
    expect(pngCompressionMinimizedFileName("example.png")).toBe("example-minimized.png");
  });

  it("大文字拡張子でも.pngへ正規化される", () => {
    expect(pngCompressionMinimizedFileName("photo.PNG")).toBe("photo-minimized.png");
  });

  it("拡張子が無いファイル名でも元の名前を維持する", () => {
    expect(pngCompressionMinimizedFileName("photo")).toBe("photo-minimized.png");
  });

  it("複数ドットを含むファイル名は最後の拡張子だけを置き換える", () => {
    expect(pngCompressionMinimizedFileName("my.photo.final.png")).toBe(
      "my.photo.final-minimized.png",
    );
  });
});
