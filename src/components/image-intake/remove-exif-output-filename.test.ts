import { describe, expect, it } from "vitest";
import { removeExifOutputFileName } from "./remove-exif-output-filename";

describe("removeExifOutputFileName", () => {
  it("拡張子をmetadata-removed.jpgへ置き換える", () => {
    expect(removeExifOutputFileName("photo.jpg")).toBe("photo-metadata-removed.jpg");
  });

  it("HEICのベース名を維持する(元のベース名を使う)", () => {
    expect(removeExifOutputFileName("IMG_1201.HEIC")).toBe("IMG_1201-metadata-removed.jpg");
  });

  it("拡張子が無いファイル名でもベース名を維持する", () => {
    expect(removeExifOutputFileName("photo")).toBe("photo-metadata-removed.jpg");
  });

  it("複数のドットを含むファイル名は最後の拡張子のみ除去する", () => {
    expect(removeExifOutputFileName("2024.06.15.jpeg")).toBe("2024.06.15-metadata-removed.jpg");
  });
});
