import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertPngBufferToWebp } from "./png-to-webp.worker";

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

function fakeBlob(size: number, type = "image/webp"): Blob {
  return {
    size,
    type,
    arrayBuffer: async () => new ArrayBuffer(Math.max(0, size)),
  } as unknown as Blob;
}

let bitmapInstances: StubBitmap[] = [];
let encodeCalls: Array<{ width: number; height: number; quality: number }> = [];
let mimeOverride: string | null = null;

class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return { drawImage: vi.fn() };
  }
  async convertToBlob(opts: { type: string; quality: number }): Promise<Blob> {
    encodeCalls.push({ width: this.width, height: this.height, quality: opts.quality });
    return fakeBlob(1000, mimeOverride ?? opts.type);
  }
}

describe("convertPngBufferToWebp", () => {
  beforeEach(() => {
    bitmapInstances = [];
    encodeCalls = [];
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

  it("quality 0.90で変換に成功する", async () => {
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.9);
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.quality).toBe(0.9);
      expect(outcome.width).toBe(800);
      expect(outcome.height).toBe(600);
      expect(outcome.webpBuffer).toBeInstanceOf(ArrayBuffer);
    }
    expect(encodeCalls[0].quality).toBe(0.9);
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("quality 0.80で変換に成功する", async () => {
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8);
    expect(outcome.status).toBe("done");
    expect(encodeCalls[0].quality).toBe(0.8);
  });

  it("quality 0.65で変換に成功する", async () => {
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.65);
    expect(outcome.status).toBe("done");
    expect(encodeCalls[0].quality).toBe(0.65);
  });

  it("blob.typeがimage/webp以外(MIMEフォールバック)の場合はunsupported-webp-encoderになる", async () => {
    mimeOverride = "image/png";
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8);
    expect(outcome.status).toBe("unsupported-webp-encoder");
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("宣言寸法と実寸法(bitmap.width/height)が一致する場合はそのまま処理する", async () => {
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8, {
      width: 800,
      height: 600,
    });
    expect(outcome.status).toBe("done");
  });

  it("幅高さの入れ替わりは一致とみなす", async () => {
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8, {
      width: 600,
      height: 800,
    });
    expect(outcome.status).toBe("done");
  });

  it("宣言寸法と実寸法が一致しない場合はdimension-mismatchとして拒否し、bitmap.closeを呼ぶ", async () => {
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8, {
      width: 4000,
      height: 4000,
    });
    expect(outcome).toEqual({ status: "dimension-mismatch" });
    expect(bitmapInstances[0].closed).toBe(true);
    expect(encodeCalls.length).toBe(0);
  });

  it("createImageBitmapが失敗した場合はerrorステータスを返す", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode failed"))),
    );
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8);
    expect(outcome).toEqual({ status: "error", message: "decode failed" });
  });

  it("デコードが時間予算を超過するとtimeoutになる", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => new Promise(() => {})), // 永遠に解決しないPromise
    );
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8, null, 10);
    expect(outcome).toEqual({ status: "timeout" });
  });

  it("エンコードが時間予算を超過するとtimeoutになる", async () => {
    class SlowOffscreenCanvas extends StubOffscreenCanvas {
      convertToBlob(): Promise<Blob> {
        return new Promise(() => {}); // 永遠に解決しないPromise
      }
    }
    vi.stubGlobal("OffscreenCanvas", SlowOffscreenCanvas);
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8, null, 10);
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
    const outcome = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8);
    expect(outcome.status).toBe("error");
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("1件目が失敗(error)しても、モジュール自体は次の呼び出しで正常に動作する", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode failed"))),
    );
    const first = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8);
    expect(first.status).toBe("error");

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(800, 600))),
    );
    const second = await convertPngBufferToWebp(new ArrayBuffer(8), 0.8);
    expect(second.status).toBe("done");
  });
});
