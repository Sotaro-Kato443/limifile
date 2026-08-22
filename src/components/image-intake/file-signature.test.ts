import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  extensionImpliedFormat,
  extractExtension,
  hasExtensionMismatch,
} from "./file-signature";

function createFile(bytes: number[], name: string, type = ""): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function buildFtypBytes(majorBrand: string, compatibleBrands: string[] = []): Uint8Array {
  const totalSize = 16 + compatibleBrands.length * 4;
  const bytes = new Uint8Array(totalSize);
  bytes[0] = (totalSize >>> 24) & 0xff;
  bytes[1] = (totalSize >>> 16) & 0xff;
  bytes[2] = (totalSize >>> 8) & 0xff;
  bytes[3] = totalSize & 0xff;
  "ftyp".split("").forEach((c, i) => (bytes[4 + i] = c.charCodeAt(0)));
  majorBrand.split("").forEach((c, i) => (bytes[8 + i] = c.charCodeAt(0)));
  compatibleBrands.forEach((brand, brandIndex) => {
    brand.split("").forEach((c, i) => (bytes[16 + brandIndex * 4 + i] = c.charCodeAt(0)));
  });
  return bytes;
}

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const WEBP_BYTES = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const GARBAGE_BYTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe("detectImageFormat", () => {
  it("JPEGのシグネチャを検出する", async () => {
    const file = createFile(JPEG_BYTES, "photo.jpg", "image/jpeg");
    await expect(detectImageFormat(file)).resolves.toBe("jpeg");
  });

  it("PNGのシグネチャを検出する", async () => {
    const file = createFile(PNG_BYTES, "photo.png", "image/png");
    await expect(detectImageFormat(file)).resolves.toBe("png");
  });

  it("WebPのシグネチャを検出する", async () => {
    const file = createFile(WEBP_BYTES, "photo.webp", "image/webp");
    await expect(detectImageFormat(file)).resolves.toBe("webp");
  });

  it("いずれの形式にも一致しないバイト列はnullを返す", async () => {
    const file = createFile(GARBAGE_BYTES, "photo.bin", "application/octet-stream");
    await expect(detectImageFormat(file)).resolves.toBeNull();
  });

  it("HEICのftypボックス(major=heic)を検出する", async () => {
    const bytes = buildFtypBytes("heic", ["mif1", "heix", "hevc"]);
    const file = createFile(Array.from(bytes), "photo.heic", "image/heic");
    await expect(detectImageFormat(file)).resolves.toBe("heic");
  });

  it("AVIFのftypボックス(major=avif)を検出する", async () => {
    const bytes = buildFtypBytes("avif", ["mif1", "miaf"]);
    const file = createFile(Array.from(bytes), "photo.avif", "image/avif");
    await expect(detectImageFormat(file)).resolves.toBe("avif");
  });

  it("avisブランド(image sequence)を含むftypもAVIFとして検出する(アニメーション判定自体は別関数の責務)", async () => {
    const bytes = buildFtypBytes("avif", ["avis", "msf1"]);
    const file = createFile(Array.from(bytes), "photo.avif", "image/avif");
    await expect(detectImageFormat(file)).resolves.toBe("avif");
  });

  it("HEICブランドと同居するAVIFブランドはAVIFとして検出する(classifyIsobmffのAVIF優先判定を踏襲)", async () => {
    const bytes = buildFtypBytes("avif", ["heic", "mif1"]);
    const file = createFile(Array.from(bytes), "photo.avif", "image/avif");
    await expect(detectImageFormat(file)).resolves.toBe("avif");
  });

  it("mif1単独のftypボックスはHEICとして検出しない", async () => {
    const bytes = buildFtypBytes("mif1", []);
    const file = createFile(Array.from(bytes), "photo.bin", "");
    await expect(detectImageFormat(file)).resolves.toBeNull();
  });

  it("極端に短いファイルでも例外を投げずnullを返す", async () => {
    const file = createFile([0xff, 0xd8], "broken.jpg", "image/jpeg");
    await expect(detectImageFormat(file)).resolves.toBeNull();
  });

  it("PNGの先頭4バイトのみ一致し残り4バイトが異なる場合はPNGと判定しない", async () => {
    // 89 50 4E 47 までは本物のPNGと一致するが、続く8バイト目までの
    // 0D 0A 1A 0A(CRLF+EOF+LF)が異なる非PNGファイルを想定
    const file = createFile(
      [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0],
      "fake.png",
      "image/png",
    );
    await expect(detectImageFormat(file)).resolves.toBeNull();
  });
});

describe("extractExtension", () => {
  it("拡張子を小文字で取り出す", () => {
    expect(extractExtension("Photo.JPG")).toBe("jpg");
  });

  it("拡張子が無い場合はnullを返す", () => {
    expect(extractExtension("photo")).toBeNull();
  });
});

describe("extensionImpliedFormat", () => {
  it("jpg/jpegはjpeg形式として扱う", () => {
    expect(extensionImpliedFormat("a.jpg")).toBe("jpeg");
    expect(extensionImpliedFormat("a.jpeg")).toBe("jpeg");
  });

  it("heic/heifはheic形式として扱う", () => {
    expect(extensionImpliedFormat("a.heic")).toBe("heic");
    expect(extensionImpliedFormat("a.HEIF")).toBe("heic");
  });

  it("avifはavif形式として扱う", () => {
    expect(extensionImpliedFormat("a.avif")).toBe("avif");
    expect(extensionImpliedFormat("a.AVIF")).toBe("avif");
  });

  it("未知の拡張子はnullを返す", () => {
    expect(extensionImpliedFormat("a.tiff")).toBeNull();
  });
});

describe("hasExtensionMismatch", () => {
  it("拡張子と実形式が食い違う場合はtrue", () => {
    expect(hasExtensionMismatch("jpeg", "photo.png")).toBe(true);
  });

  it("拡張子と実形式が一致する場合はfalse", () => {
    expect(hasExtensionMismatch("png", "photo.png")).toBe(false);
  });

  it("実形式が未対応(null)の場合は不一致警告にしない", () => {
    expect(hasExtensionMismatch(null, "photo.heic")).toBe(false);
  });

  it("拡張子から形式を推測できない場合は不一致警告にしない", () => {
    expect(hasExtensionMismatch("jpeg", "photo")).toBe(false);
  });
});
