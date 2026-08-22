import { describe, expect, it } from "vitest";
import { getImageDimensions } from "./image-dimensions";

interface FakeImageOptions {
  width: number;
  height: number;
  shouldFail?: boolean;
}

function createFakeImageFactory(options: FakeImageOptions) {
  return () => {
    const image = {
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      naturalWidth: options.width,
      naturalHeight: options.height,
      src: "",
    };

    Object.defineProperty(image, "src", {
      set() {
        queueMicrotask(() => {
          if (options.shouldFail) {
            image.onerror?.();
          } else {
            image.onload?.();
          }
        });
      },
    });

    return image;
  };
}

describe("getImageDimensions", () => {
  it("画像の幅と高さを解決する", async () => {
    const dimensions = await getImageDimensions(
      "blob:test",
      createFakeImageFactory({ width: 800, height: 600 }),
    );
    expect(dimensions).toEqual({ width: 800, height: 600 });
  });

  it("読み込みに失敗した場合は拒否される", async () => {
    await expect(
      getImageDimensions(
        "blob:test",
        createFakeImageFactory({ width: 0, height: 0, shouldFail: true }),
      ),
    ).rejects.toThrow("画像を読み込めませんでした");
  });
});
