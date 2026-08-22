import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertRasterBufferToJpeg } from "./raster-convert.worker";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";

class StubBitmap {
  width: number;
  height: number;
  closed = false;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  close(): void {
    this.closed = true;
  }
}

function fakeBlob(size: number, type = "image/jpeg"): Blob {
  return {
    size,
    type,
    arrayBuffer: async () => new ArrayBuffer(Math.max(0, size)),
  } as unknown as Blob;
}

let bitmapInstances: StubBitmap[] = [];
let encodeCalls: Array<{ width: number; height: number; quality: number }> = [];
let fillCalls: Array<{ fillStyle: string; rect: [number, number, number, number] }> = [];
let drawImageCalls: number;
let mimeOverride: string | null = null;

class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    const ctx = {
      fillStyle: "",
      fillRect: (x: number, y: number, w: number, h: number) => {
        fillCalls.push({ fillStyle: ctx.fillStyle, rect: [x, y, w, h] });
      },
      drawImage: vi.fn(() => {
        drawImageCalls += 1;
      }),
    };
    return ctx;
  }
  async convertToBlob(opts: { type: string; quality: number }): Promise<Blob> {
    encodeCalls.push({ width: this.width, height: this.height, quality: opts.quality });
    return fakeBlob(1000, mimeOverride ?? opts.type);
  }
}

describe("convertRasterBufferToJpeg", () => {
  beforeEach(() => {
    bitmapInstances = [];
    encodeCalls = [];
    fillCalls = [];
    drawImageCalls = 0;
    mimeOverride = null;
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const bitmap = new StubBitmap(800, 600);
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PNG入力・quality 0.90で変換に成功する", async () => {
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.9,
      DEFAULT_RASTER_BACKGROUND,
    );
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.quality).toBe(0.9);
      expect(outcome.width).toBe(800);
      expect(outcome.height).toBe(600);
      expect(outcome.jpegBuffer).toBeInstanceOf(ArrayBuffer);
    }
    expect(encodeCalls[0].quality).toBe(0.9);
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("WebP入力でも変換に成功する", async () => {
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "webp",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
    );
    expect(outcome.status).toBe("done");
  });

  it("quality 0.65/0.80/0.90はいずれも許可され正常に処理される", async () => {
    for (const quality of [0.65, 0.8, 0.9]) {
      const outcome = await convertRasterBufferToJpeg(
        new ArrayBuffer(8),
        "png",
        quality,
        DEFAULT_RASTER_BACKGROUND,
      );
      expect(outcome.status).toBe("done");
    }
  });

  it("描画前に背景色でfillRectしてからdrawImageする(透明部分の塗りつぶし)", async () => {
    await convertRasterBufferToJpeg(new ArrayBuffer(8), "png", 0.8, { r: 10, g: 20, b: 30 });
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].fillStyle).toBe("rgb(10, 20, 30)");
    expect(fillCalls[0].rect).toEqual([0, 0, 800, 600]);
    expect(drawImageCalls).toBe(1);
  });

  it("不透明な画像でも常に背景を塗りつぶす(透明判定の分岐を持たない単純化)", async () => {
    await convertRasterBufferToJpeg(new ArrayBuffer(8), "webp", 0.8, DEFAULT_RASTER_BACKGROUND);
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].fillStyle).toBe("rgb(255, 255, 255)");
  });

  it("blob.typeがimage/jpeg以外(MIMEフォールバック)の場合はunsupported-encoderになる", async () => {
    mimeOverride = "image/png";
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
    );
    expect(outcome.status).toBe("unsupported-encoder");
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("宣言寸法と実寸法(bitmap.width/height)が一致する場合はそのまま処理する", async () => {
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      { width: 800, height: 600 },
    );
    expect(outcome.status).toBe("done");
  });

  it("幅高さの入れ替わりは一致とみなす", async () => {
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      { width: 600, height: 800 },
    );
    expect(outcome.status).toBe("done");
  });

  it("宣言寸法と実寸法が一致しない場合はdimension-mismatchとして拒否し、bitmap.closeを呼ぶ", async () => {
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      { width: 4000, height: 4000 },
    );
    expect(outcome).toEqual({ status: "dimension-mismatch" });
    expect(bitmapInstances[0].closed).toBe(true);
    expect(encodeCalls.length).toBe(0);
  });

  it("createImageBitmapが失敗した場合はerrorステータスを返す", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode failed"))),
    );
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
    );
    expect(outcome).toEqual({ status: "error", message: "decode failed" });
  });

  it("デコードが時間予算を超過するとtimeoutになる", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => new Promise(() => {})), // 永遠に解決しないPromise
    );
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      null,
      10,
    );
    expect(outcome).toEqual({ status: "timeout" });
  });

  it("エンコードが時間予算を超過するとtimeoutになる", async () => {
    class SlowOffscreenCanvas extends StubOffscreenCanvas {
      convertToBlob(): Promise<Blob> {
        return new Promise(() => {}); // 永遠に解決しないPromise
      }
    }
    vi.stubGlobal("OffscreenCanvas", SlowOffscreenCanvas);
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      null,
      10,
    );
    expect(outcome).toEqual({ status: "timeout" });
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("OffscreenCanvasの2Dコンテキストが取得できない場合はerrorになる", async () => {
    class NoContextCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext(): null {
        return null;
      }
      convertToBlob(): Promise<Blob> {
        throw new Error("getContext()がnullのため呼ばれないはず");
      }
    }
    vi.stubGlobal("OffscreenCanvas", NoContextCanvas);
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
    );
    expect(outcome.status).toBe("error");
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("AVIF入力(declaredDimensions=null)は寸法照合をスキップしてそのまま処理する", async () => {
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "avif",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      null,
    );
    expect(outcome.status).toBe("done");
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("AVIFはcreateImageBitmap後の実寸法がDECODE_SAFETY_LIMITSを超える場合、unsafe-dimensionsとして拒否しbitmapを閉じる(encodeは呼ばない)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        // DECODE_SAFETY_LIMITS.maxDimension(16384)を超える辺を持つbitmapを模す。
        // clap/irot/imir等のtransformative propertyにより、ispeの宣言寸法とdecode後の
        // 実寸法が食い違うケースを想定した検証(このためAVIFはdeclaredDimensionsとの
        // 完全一致を要求せず、decode後の実寸法自体を独立して再検証する)。
        const bitmap = new StubBitmap(20000, 100);
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "avif",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      null,
    );
    expect(outcome).toEqual({ status: "unsafe-dimensions" });
    expect(bitmapInstances[0].closed).toBe(true);
    expect(encodeCalls.length).toBe(0);
  });

  it("AVIFでも実寸法が安全上限内であれば正常に処理する", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const bitmap = new StubBitmap(4032, 3024);
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "avif",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      null,
    );
    expect(outcome.status).toBe("done");
  });

  it("PNG/WebPは実寸法をDECODE_SAFETY_LIMITSで再検証しない(既存のdeclaredDimensions照合のみ)", async () => {
    // AVIF専用のpost-decode再検証がPNG/WebPの既存挙動を変えていないことを確認する。
    // StubBitmapは既定800x600(安全上限内)のため、この呼び出し自体は元々doneになるが、
    // sourceFormatがpng/webpの場合にのみ新設のavif分岐を通らないことをカバーする。
    const outcome = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
      null,
    );
    expect(outcome.status).toBe("done");
  });

  it("1件目が失敗(error)しても、モジュール自体は次の呼び出しで正常に動作する", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode failed"))),
    );
    const first = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "png",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
    );
    expect(first.status).toBe("error");

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(800, 600))),
    );
    const second = await convertRasterBufferToJpeg(
      new ArrayBuffer(8),
      "webp",
      0.8,
      DEFAULT_RASTER_BACKGROUND,
    );
    expect(second.status).toBe("done");
  });
});
