import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./target-fit.worker";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import { MAX_TARGET_FIT_INPUT_BYTES } from "./target-fit-types";
import type {
  TargetFitWorkerRequestMessage,
  TargetFitWorkerResultMessage,
} from "./target-fit.worker";

/**
 * self.onmessage(Worker全体のメッセージルーティング)を通した統合テスト。
 * target-fit.worker.test.ts(targetFitBufferToJpegの純粋関数レベルテスト)では検証できない、
 * 「リクエスト検証(clampせずinvalid-requestで拒否する)・アニメーション判定・寸法安全性検証が
 * targetFitBufferToJpegを呼ぶ前に正しく行われること」を確認する
 * (raster-convert.worker.integration.test.tsと同じ設計)。
 */

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}
function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}
function ihdrData(width: number, height: number): number[] {
  return [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0];
}
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildPng(
  width: number,
  height: number,
  options: { animated?: boolean } = {},
): ArrayBuffer {
  const chunks = [pngChunk("IHDR", ihdrData(width, height))];
  if (options.animated) {
    chunks.push(pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]));
  }
  chunks.push(pngChunk("IDAT", [1, 2, 3, 4]));
  chunks.push(pngChunk("IEND", []));
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]).buffer;
}

function buildJpegBytes(width: number, height: number) {
  const bytes = new Uint8Array(11);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes[4] = 0;
  bytes[5] = 7;
  bytes[6] = 8;
  bytes[7] = (height >>> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >>> 8) & 0xff;
  bytes[10] = width & 0xff;
  return bytes;
}

function buildJpeg(width: number, height: number): ArrayBuffer {
  return buildJpegBytes(width, height).buffer;
}

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

class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return {
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillRect: () => {},
      drawImage: () => {},
    };
  }
  async convertToBlob(opts: { type: string }): Promise<Blob> {
    // canvas実寸法(=target-fit.worker.tsがtargetWidth/targetHeightで作成したcanvas)を
    // 実際にheaderへ埋め込んだJPEGを返す。target-fit.worker.tsのfinalizeOutcome()は
    // このバイト列を再parseしてcandidate.width/heightを決めるため、ここで「本当に
    // その寸法のJPEGが出力された」という体裁を保つ必要がある。
    const bytes = buildJpegBytes(this.width, this.height);
    return {
      size: bytes.length,
      type: opts.type,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Blob;
  }
}

function baseRequest(
  overrides: Partial<TargetFitWorkerRequestMessage> = {},
): TargetFitWorkerRequestMessage {
  return {
    id: "a",
    buffer: buildPng(800, 600),
    sourceFormat: "png",
    targetWidth: 200,
    targetHeight: 100,
    maxBytes: 100_000,
    fitMode: "contain",
    background: DEFAULT_RASTER_BACKGROUND,
    ...overrides,
  };
}

async function sendMessage(message: TargetFitWorkerRequestMessage): Promise<void> {
  const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
  await handler({ data: message } as MessageEvent);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function resultMessages(
  postMessageSpy: ReturnType<typeof vi.spyOn>,
): TargetFitWorkerResultMessage[] {
  return postMessageSpy.mock.calls.map(
    (call: unknown[]) => call[0] as TargetFitWorkerResultMessage,
  );
}

describe("target-fit.worker self.onmessage", () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(800, 600))),
    );
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("通常PNGはdoneを返し、jpegBufferがtransfer listに含まれる", async () => {
    await sendMessage(baseRequest());
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
    if (message.status === "done") {
      expect(message.candidate.jpegBuffer).toBeInstanceOf(ArrayBuffer);
      expect(message.candidate.width).toBe(200);
      expect(message.candidate.height).toBe(100);
    }
    const transferArg = postMessageSpy.mock.calls[0][1] as Transferable[];
    expect(transferArg).toHaveLength(1);
  });

  it("通常JPEGもdoneを返す", async () => {
    await sendMessage(baseRequest({ buffer: buildJpeg(800, 600), sourceFormat: "jpeg" }));
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
  });

  it("APNGはcreateImageBitmapへ渡す前にunsupported-animationとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage(baseRequest({ buffer: buildPng(800, 600, { animated: true }) }));

    expect(bitmapSpy).not.toHaveBeenCalled();
    expect(resultMessages(postMessageSpy)[0]).toEqual({
      id: "a",
      type: "result",
      status: "unsupported-animation",
    });
  });

  it("宣言寸法が最大辺を超える場合、createImageBitmapへ渡す前にunsafe-dimensionsとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage(baseRequest({ buffer: buildPng(20000, 20000) }));

    expect(bitmapSpy).not.toHaveBeenCalled();
    expect(resultMessages(postMessageSpy)[0]).toEqual({
      id: "a",
      type: "result",
      status: "unsafe-dimensions",
    });
  });

  it("maxBytesが極端に小さい場合、unreachableとbestCandidateを返す", async () => {
    await sendMessage(baseRequest({ maxBytes: 1 }));
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("unreachable");
    if (message.status === "unreachable") {
      expect(message.bestCandidate.jpegBuffer).toBeInstanceOf(ArrayBuffer);
    }
  });

  describe("リクエスト検証(clampせず、不正な値はinvalid-requestとして拒否する)", () => {
    const bitmapSpyReady = () => vi.mocked(createImageBitmap);

    it("idが空文字の場合はinvalid-request", async () => {
      await sendMessage(baseRequest({ id: "" }));
      expect(bitmapSpyReady()).not.toHaveBeenCalled();
      expect(resultMessages(postMessageSpy)[0]).toMatchObject({ status: "invalid-request" });
    });

    it("bufferがMAX_TARGET_FIT_INPUT_BYTESを超える場合はinvalid-request", async () => {
      const oversized = new ArrayBuffer(MAX_TARGET_FIT_INPUT_BYTES + 1);
      await sendMessage(baseRequest({ buffer: oversized }));
      expect(bitmapSpyReady()).not.toHaveBeenCalled();
      expect(resultMessages(postMessageSpy)[0]).toEqual({
        id: "a",
        type: "result",
        status: "invalid-request",
      });
    });

    it("sourceFormatが不正な場合はinvalid-request", async () => {
      await sendMessage(baseRequest({ sourceFormat: "webp" as never }));
      expect(bitmapSpyReady()).not.toHaveBeenCalled();
      expect(resultMessages(postMessageSpy)[0]).toEqual({
        id: "a",
        type: "result",
        status: "invalid-request",
      });
    });

    it("targetWidthが0以下の場合、値をclampせずinvalid-requestとして拒否する", async () => {
      await sendMessage(baseRequest({ targetWidth: 0 }));
      expect(bitmapSpyReady()).not.toHaveBeenCalled();
      expect(resultMessages(postMessageSpy)[0]).toEqual({
        id: "a",
        type: "result",
        status: "invalid-request",
      });
    });

    it("targetHeightが安全上限(maxDimension)を超える場合、clampせずinvalid-requestとして拒否する", async () => {
      await sendMessage(baseRequest({ targetHeight: 999999 }));
      expect(bitmapSpyReady()).not.toHaveBeenCalled();
      expect(resultMessages(postMessageSpy)[0]).toEqual({
        id: "a",
        type: "result",
        status: "invalid-request",
      });
    });

    it("maxBytesが0以下の場合はinvalid-request", async () => {
      await sendMessage(baseRequest({ maxBytes: 0 }));
      expect(bitmapSpyReady()).not.toHaveBeenCalled();
      expect(resultMessages(postMessageSpy)[0]).toEqual({
        id: "a",
        type: "result",
        status: "invalid-request",
      });
    });

    it("fitModeが不正な場合はinvalid-request", async () => {
      await sendMessage(baseRequest({ fitMode: "cover" as never }));
      expect(bitmapSpyReady()).not.toHaveBeenCalled();
      expect(resultMessages(postMessageSpy)[0]).toEqual({
        id: "a",
        type: "result",
        status: "invalid-request",
      });
    });

    it("backgroundのr/g/bが0-255範囲外の場合はinvalid-request", async () => {
      await sendMessage(baseRequest({ background: { r: 300, g: 0, b: 0 } }));
      expect(bitmapSpyReady()).not.toHaveBeenCalled();
      expect(resultMessages(postMessageSpy)[0]).toEqual({
        id: "a",
        type: "result",
        status: "invalid-request",
      });
    });
  });
});
