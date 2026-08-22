import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const decodeMock = vi.fn();

vi.mock("@discourse/heic/decode", () => ({
  default: (...args: unknown[]) => decodeMock(...args),
}));

class StubOffscreenCanvasContext {
  putImageData = vi.fn();
}

let convertToBlobImpl: (opts: { type: string; quality: number }) => Promise<Blob>;

class StubOffscreenCanvas {
  width: number;
  height: number;
  private context = new StubOffscreenCanvasContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return this.context;
  }

  async convertToBlob(opts: { type: string; quality: number }) {
    return convertToBlobImpl(opts);
  }
}

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  } as ImageData;
}

async function defaultConvertToBlob(opts: { type: string; quality: number }): Promise<Blob> {
  return new Blob([new Uint8Array([1, 2, 3])], { type: opts.type });
}

describe("convertHeicBufferToJpeg", () => {
  beforeEach(() => {
    decodeMock.mockReset();
    convertToBlobImpl = defaultConvertToBlob;
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("quality 0.8で正常にJPEGバッファと寸法を返す", async () => {
    decodeMock.mockResolvedValue(makeImageData(800, 600));

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);

    expect(result.status).toBe("done");
    if (result.status === "done") {
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.jpegType).toBe("image/jpeg");
      expect(result.jpegBuffer.byteLength).toBeGreaterThan(0);
    }
    expect(decodeMock).toHaveBeenCalledTimes(1);
  });

  it("decode失敗時はerrorステータスを返す", async () => {
    decodeMock.mockRejectedValue(new Error("Decoding error"));

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);
    expect(result).toEqual({ status: "error", message: "Decoding error" });
  });

  it("decodeが時間予算を超過するとtimeoutになる", async () => {
    decodeMock.mockReturnValue(new Promise(() => {})); // 永遠に解決しないPromise

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8, 10);
    expect(result).toEqual({ status: "timeout" });
  });

  it("エンコードが時間予算を超過するとtimeoutになる", async () => {
    decodeMock.mockResolvedValue(makeImageData(10, 10));
    convertToBlobImpl = () => new Promise(() => {}); // 永遠に解決しないPromise

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8, 10);
    expect(result).toEqual({ status: "timeout" });
  });

  it("width 0のImageDataはunsafe-dimensionsとして拒否する", async () => {
    decodeMock.mockResolvedValue(makeImageData(0, 100));

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);
    expect(result).toEqual({ status: "unsafe-dimensions" });
  });

  it("height 0のImageDataはunsafe-dimensionsとして拒否する", async () => {
    decodeMock.mockResolvedValue(makeImageData(100, 0));

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);
    expect(result).toEqual({ status: "unsafe-dimensions" });
  });

  it("最大辺(16384px)を超えるImageDataはunsafe-dimensionsとして拒否する", async () => {
    decodeMock.mockResolvedValue({
      width: 20000,
      height: 10,
      data: new Uint8ClampedArray(0), // 意図的にdata長は検証しない(先に辺の上限で拒否される)
      colorSpace: "srgb",
    } as unknown as ImageData);

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);
    expect(result).toEqual({ status: "unsafe-dimensions" });
  });

  it("総ピクセル数(67,108,864px)を超えるImageDataはunsafe-dimensionsとして拒否する", async () => {
    decodeMock.mockResolvedValue({
      width: 10000,
      height: 10000, // 100,000,000px > 67,108,864px
      data: new Uint8ClampedArray(0),
      colorSpace: "srgb",
    } as unknown as ImageData);

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);
    expect(result).toEqual({ status: "unsafe-dimensions" });
  });

  it("data.lengthがwidth*height*4と一致しないImageDataはunsafe-dimensionsとして拒否する", async () => {
    decodeMock.mockResolvedValue({
      width: 100,
      height: 100,
      data: new Uint8ClampedArray(10), // 100*100*4=40000のはずが10しかない
      colorSpace: "srgb",
    } as unknown as ImageData);

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);
    expect(result).toEqual({ status: "unsafe-dimensions" });
  });

  it("blob.typeがimage/jpeg以外(MIMEフォールバック)の場合はunsupported-jpeg-encoderになる", async () => {
    decodeMock.mockResolvedValue(makeImageData(10, 10));
    convertToBlobImpl = async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);
    expect(result).toEqual({ status: "unsupported-jpeg-encoder" });
  });

  it("空のBlob(size=0)が返された場合はunsupported-jpeg-encoderになる", async () => {
    decodeMock.mockResolvedValue(makeImageData(10, 10));
    convertToBlobImpl = async () => new Blob([], { type: "image/jpeg" });

    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8);
    expect(result).toEqual({ status: "unsupported-jpeg-encoder" });
  });

  describe("decode/convertToBlobで共有するdeadline", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("decodeとconvertToBlobの合計が時間予算(30秒)未満なら成功する", async () => {
      decodeMock.mockResolvedValue(makeImageData(10, 10));
      // defaultConvertToBlobは即座に解決するため、実時間・fakeTimerいずれも待たずに完了する

      const { convertHeicBufferToJpeg, TIME_BUDGET_MS } = await import("./heic-convert.worker");
      const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8, TIME_BUDGET_MS);
      expect(result.status).toBe("done");
    });

    it("decode単体が時間予算(30秒)を超えるとtimeoutになる(Fake Timers使用、実時間では待たない)", async () => {
      vi.useFakeTimers();
      decodeMock.mockReturnValue(new Promise(() => {})); // 永遠に解決しない

      const { convertHeicBufferToJpeg, TIME_BUDGET_MS } = await import("./heic-convert.worker");
      const resultPromise = convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8, TIME_BUDGET_MS);
      await vi.advanceTimersByTimeAsync(TIME_BUDGET_MS);
      const result = await resultPromise;
      expect(result).toEqual({ status: "timeout" });
    });

    it("decode完了後に残り時間が無い場合、convertToBlobを一切呼び出さずtimeoutを返す", async () => {
      decodeMock.mockResolvedValue(makeImageData(10, 10));
      const convertToBlobSpy = vi.fn(defaultConvertToBlob);
      convertToBlobImpl = convertToBlobSpy;

      // 1回目(deadline算出)・2回目(decode前の残り時間算出)はt=0、
      // 3回目(decode完了後の残り時間算出)はtimeBudgetMsを使い切った後としてt=100000を返す
      let callCount = 0;
      const now = () => {
        callCount += 1;
        return callCount <= 2 ? 0 : 100000;
      };

      const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
      const result = await convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8, 30000, now);

      expect(result).toEqual({ status: "timeout" });
      expect(convertToBlobSpy).not.toHaveBeenCalled();
    });

    it("decodeとconvertToBlobの合計が時間予算(30秒)を超えた場合timeoutになる(Fake Timers使用)", async () => {
      vi.useFakeTimers();
      decodeMock.mockResolvedValue(makeImageData(10, 10));
      convertToBlobImpl = () => new Promise(() => {}); // 永遠に解決しない

      // decodeで25秒消費した想定とし、convertToBlobへは残り5秒だけを与える
      let callCount = 0;
      const now = () => {
        callCount += 1;
        return callCount <= 2 ? 0 : 25000;
      };

      const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
      const resultPromise = convertHeicBufferToJpeg(new ArrayBuffer(8), 0.8, 30000, now);
      await vi.advanceTimersByTimeAsync(5000);
      const result = await resultPromise;
      expect(result).toEqual({ status: "timeout" });
    });
  });

  it("Worker側の時間予算(30秒)はクライアント側バックストップ(35秒)より小さい", async () => {
    const { TIME_BUDGET_MS } = await import("./heic-convert.worker");
    const { CLIENT_TIMEOUT_MS } = await import("./heic-conversion-client");
    expect(TIME_BUDGET_MS).toBeLessThan(CLIENT_TIMEOUT_MS);
  });
});
