import { describe, expect, it } from "vitest";
import { pngToWebpOutputFileName } from "./png-to-webp-output-filename";

describe("pngToWebpOutputFileName", () => {
  it("拡張子を.webpへ置き換える", () => {
    expect(pngToWebpOutputFileName("photo.png")).toBe("photo.webp");
  });

  it("大文字拡張子でも.webpになる", () => {
    expect(pngToWebpOutputFileName("PHOTO.PNG")).toBe("PHOTO.webp");
  });

  it("複数ドットを含むファイル名は最後の拡張子だけを置き換える", () => {
    expect(pngToWebpOutputFileName("my.image.PNG")).toBe("my.image.webp");
  });

  it("拡張子が無いファイル名でも元の名前を維持する", () => {
    expect(pngToWebpOutputFileName("photo")).toBe("photo.webp");
  });

  it("長いファイル名でも正しく変換する", () => {
    const longName = "a".repeat(200) + ".png";
    expect(pngToWebpOutputFileName(longName)).toBe("a".repeat(200) + ".webp");
  });

  it("危険文字(パス区切り等)を含む名前でもそのままベース名として扱う(サニタイズは行わない、既存規則と同じ)", () => {
    expect(pngToWebpOutputFileName("../etc/passwd.png")).toBe("../etc/passwd.webp");
  });

  it("空白や記号を含むファイル名でも動作する", () => {
    expect(pngToWebpOutputFileName("my photo (1).png")).toBe("my photo (1).webp");
  });
});
