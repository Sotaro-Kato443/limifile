import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getImageDimensions } from "./image-dimensions";
import {
  MAX_RASTER_PRE_DECODE_INPUT_BYTES,
  rasterPreDecodeSafetyPreflight,
} from "./raster-pre-decode-safety";

vi.mock("./image-dimensions", () => ({
  getImageDimensions: vi.fn(),
}));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildPngBytes(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  bytes[11] = 13;
  "IHDR".split("").forEach((c, i) => (bytes[12 + i] = c.charCodeAt(0)));
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function createPngFile(width: number, height: number, size?: number): File {
  const dims = buildPngBytes(width, height);
  if (size === undefined || size <= dims.length) {
    return new File([dims], "photo.png", { type: "image/png" });
  }
  const padded = new Uint8Array(size);
  padded.set(dims);
  return new File([padded], "photo.png", { type: "image/png" });
}

describe("rasterPreDecodeSafetyPreflight", () => {
  beforeEach(() => {
    vi.mocked(getImageDimensions).mockReset();
    vi.mocked(getImageDimensions).mockResolvedValue({ width: 1, height: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("file.sizeが上限を超える場合、file.arrayBuffer()を呼ぶ前にtoo-largeを返す", async () => {
    const file = createPngFile(400, 300, MAX_RASTER_PRE_DECODE_INPUT_BYTES + 1);
    const arrayBufferSpy = vi.spyOn(file, "arrayBuffer");

    const outcome = await rasterPreDecodeSafetyPreflight(file, "blob:mock", "png");

    expect(outcome).toEqual({ kind: "too-large" });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("宣言寸法が安全な場合、getImageDimensionsを呼びreadyを返す", async () => {
    const file = createPngFile(400, 300);
    vi.mocked(getImageDimensions).mockResolvedValue({ width: 400, height: 300 });

    const outcome = await rasterPreDecodeSafetyPreflight(file, "blob:mock", "png");

    expect(outcome).toEqual({ kind: "ready", dimensions: { width: 400, height: 300 } });
    expect(getImageDimensions).toHaveBeenCalledWith("blob:mock");
  });

  it("宣言寸法が安全上限を超える場合、getImageDimensionsを呼ばずunsafe-dimensionsを返す", async () => {
    const file = createPngFile(99999, 99999);

    const outcome = await rasterPreDecodeSafetyPreflight(file, "blob:mock", "png");

    expect(outcome).toEqual({ kind: "unsafe-dimensions" });
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("ヘッダーを解析できない場合(壊れたPNG)、getImageDimensionsを呼ばずunsafe-dimensionsを返す", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "junk.png", { type: "image/png" });

    const outcome = await rasterPreDecodeSafetyPreflight(file, "blob:mock", "png");

    expect(outcome).toEqual({ kind: "unsafe-dimensions" });
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("宣言寸法検証までは安全でも、getImageDimensions自体が失敗した場合decode-failedを返す", async () => {
    const file = createPngFile(400, 300);
    vi.mocked(getImageDimensions).mockRejectedValue(new Error("decode failed"));

    const outcome = await rasterPreDecodeSafetyPreflight(file, "blob:mock", "png");

    expect(outcome).toEqual({ kind: "decode-failed" });
  });
});
