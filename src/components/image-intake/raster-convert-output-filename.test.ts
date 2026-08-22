import { describe, expect, it } from "vitest";
import { rasterToJpgOutputFileName } from "./raster-convert-output-filename";

describe("rasterToJpgOutputFileName", () => {
  it("PNG拡張子を.jpgへ置き換える", () => {
    expect(rasterToJpgOutputFileName("photo.png")).toBe("photo.jpg");
  });

  it("WebP拡張子を.jpgへ置き換える", () => {
    expect(rasterToJpgOutputFileName("photo.webp")).toBe("photo.jpg");
  });

  it("大文字拡張子も.jpgへ置き換える", () => {
    expect(rasterToJpgOutputFileName("my.image.PNG")).toBe("my.image.jpg");
    expect(rasterToJpgOutputFileName("my.image.WEBP")).toBe("my.image.jpg");
  });

  it("複数ドットを含むファイル名でも最後の拡張子だけを置き換える", () => {
    expect(rasterToJpgOutputFileName("a.b.c.png")).toBe("a.b.c.jpg");
  });

  it("拡張子が無い場合はそのまま.jpgを付与する", () => {
    expect(rasterToJpgOutputFileName("noext")).toBe("noext.jpg");
  });
});
