import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./png-to-webp.worker";
import type {
  PngToWebpWorkerRequestMessage,
  PngToWebpWorkerResultMessage,
} from "./png-to-webp.worker";

/**
 * self.onmessage(Worker全体のメッセージルーティング)を通した統合テスト。
 * 純粋関数レベルのテスト(png-to-webp.worker.test.ts / apng-detection.test.ts /
 * png-chunks.test.ts / decode-safety.test.ts)では検証できない、
 * 「APNG判定・寸法安全性検証がcreateImageBitmap前に行われること」を確認する。
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

class StubBitmap {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  close(): void {}
}

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
  async convertToBlob(opts: { type: string; quality?: number }) {
    return {
      size: 10,
      type: opts.type,
      arrayBuffer: async () => new ArrayBuffer(10),
    } as unknown as Blob;
  }
}

async function sendMessage(message: PngToWebpWorkerRequestMessage): Promise<void> {
  const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
  await handler({ data: message } as MessageEvent);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function resultMessages(
  postMessageSpy: ReturnType<typeof vi.spyOn>,
): PngToWebpWorkerResultMessage[] {
  return postMessageSpy.mock.calls
    .map((call: unknown[]) => call[0] as PngToWebpWorkerResultMessage)
    .filter((message: PngToWebpWorkerResultMessage) => message.type === "result");
}

describe("png-to-webp.worker self.onmessage", () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    // 宣言寸法(このファイルのテストで使うPNGフィクスチャは800x600)と一致させ、
    // dimension-mismatch検証で意図せず拒否されないようにする
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(800, 600))),
    );
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("通常PNGは正常にdoneを返す", async () => {
    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: 0.8 });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
    if (message.status === "done") {
      expect(message.webpBuffer).toBeInstanceOf(ArrayBuffer);
      expect(message.quality).toBe(0.8);
    }
  });

  it("APNGはcreateImageBitmapへ渡す前にunsupported-animationとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildPng(800, 600, { animated: true }),
      quality: 0.8,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsupported-animation" });
  });

  it("壊れたPNG(先頭チャンクがIHDRではない)はcreateImageBitmapへ渡す前にmalformed-pngとして拒否する", async () => {
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...pngChunk("IDAT", [1, 2, 3]),
      ...pngChunk("IEND", []),
    ]);

    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: bytes.buffer, quality: 0.8 });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "malformed-png" });
  });

  it("PNG署名すら無いバイト列もmalformed-pngとして安全に拒否する", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: bytes.buffer, quality: 0.8 });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "malformed-png" });
  });

  it("宣言寸法が最大辺を超える場合、createImageBitmapへ渡す前にunsafe-dimensionsとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: buildPng(20000, 20000), quality: 0.8 });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsafe-dimensions" });
  });

  it("宣言寸法と実デコード寸法が一致しない場合、dimension-mismatchとして拒否する", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(4000, 4000))),
    );

    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: 0.8 });

    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "dimension-mismatch" });
  });

  it("quality 0.65は許可され正常に処理される", async () => {
    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: 0.65 });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
  });

  it("quality 0.80は許可され正常に処理される", async () => {
    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: 0.8 });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
  });

  it("quality 0.90は許可され正常に処理される", async () => {
    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: 0.9 });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
  });

  it("quality 1.0はcreateImageBitmapへ渡す前にinvalid-qualityとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: 1.0 });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "invalid-quality" });
  });

  it("quality NaNはcreateImageBitmapへ渡す前にinvalid-qualityとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: NaN });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "invalid-quality" });
  });

  it("quality InfinityはcreateImageBitmapへ渡す前にinvalid-qualityとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: Infinity });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "invalid-quality" });
  });

  it("許可されていない任意の中間値(0.75)はcreateImageBitmapへ渡す前にinvalid-qualityとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: buildPng(800, 600), quality: 0.75 });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "invalid-quality" });
  });

  it("1件目がAPNGで拒否された後も、2件目(通常PNG)は正常に処理される(1件の失敗が他を止めない)", async () => {
    await sendMessage({
      id: "a",
      buffer: buildPng(800, 600, { animated: true }),
      quality: 0.8,
    });
    await sendMessage({ id: "b", buffer: buildPng(800, 600), quality: 0.8 });

    const messages = resultMessages(postMessageSpy);
    expect(messages.find((m) => m.id === "a")?.status).toBe("unsupported-animation");
    expect(messages.find((m) => m.id === "b")?.status).toBe("done");
  });
});
