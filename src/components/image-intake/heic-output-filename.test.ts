import { describe, expect, it } from "vitest";
import { heicOutputFileName } from "./heic-output-filename";

describe("heicOutputFileName", () => {
  it("拡張子を.jpgに置き換える", () => {
    expect(heicOutputFileName("IMG_1201.heic")).toBe("IMG_1201.jpg");
    expect(heicOutputFileName("IMG_1201.HEIC")).toBe("IMG_1201.jpg");
    expect(heicOutputFileName("photo.heif")).toBe("photo.jpg");
  });

  it("拡張子が無い場合は末尾に.jpgを付与する", () => {
    expect(heicOutputFileName("noext")).toBe("noext.jpg");
  });

  it("ファイル名中のドットを含むベース名を保持する", () => {
    expect(heicOutputFileName("2026.07.24.heic")).toBe("2026.07.24.jpg");
  });
});
