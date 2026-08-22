import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./image-compress.worker";
import type {
  CompressWorkerRequestMessage,
  CompressWorkerResultMessage,
} from "./image-compress.worker";

/**
 * self.onmessage(Worker全体のメッセージルーティング)を通した統合テスト。
 * 純粋関数レベルのテスト(image-compress.worker.test.ts / image-compress-webp.test.ts /
 * image-header-dimensions.test.ts / decode-safety.test.ts)では検証できない、
 * 「createImageBitmap前の寸法安全性チェック」と「format(jpeg/webp)によるルーティング」が
 * self.onmessage内で正しく組み合わさっていることを確認する。
 */

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function buildValidJpeg(width: number, height: number): ArrayBuffer {
  const sof0Payload = [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0];
  const bytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    ...u16be(sof0Payload.length + 2),
    ...sof0Payload,
    0xff,
    0xd9,
  ]);
  return bytes.buffer;
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

async function sendMessage(message: CompressWorkerRequestMessage): Promise<void> {
  const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
  await handler({ data: message } as MessageEvent);
  // self.onmessage内はasync即時関数のため、postMessageが呼ばれるまでマイクロタスクを数回消化する
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function resultMessages(
  postMessageSpy: ReturnType<typeof vi.spyOn>,
): CompressWorkerResultMessage[] {
  return postMessageSpy.mock.calls
    .map((call: unknown[]) => call[0] as CompressWorkerResultMessage)
    .filter((message: CompressWorkerResultMessage) => message.type === "result");
}

describe("image-compress.worker self.onmessage", () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    // 宣言寸法(このファイルのテストで使うJPEG/WebPフィクスチャは800x600)と一致させ、
    // 新設のdimension-mismatch検証で意図せず拒否されないようにする
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(800, 600))),
    );
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("宣言寸法が読み取れない場合、createImageBitmapを呼ばずunsafe-dimensionsを返す", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: new ArrayBuffer(4), // JPEGとして解析できない不正なバイト列
      targetBytes: 1000,
      format: "jpeg",
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = postMessageSpy.mock.calls[0][0] as CompressWorkerResultMessage;
    expect(message).toEqual({ id: "a", type: "result", status: "unsafe-dimensions" });
  });

  it("宣言寸法が最大辺を超える場合、createImageBitmapを呼ばずunsafe-dimensionsを返す", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildValidJpeg(20000, 20000),
      targetBytes: 1000,
      format: "jpeg",
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = postMessageSpy.mock.calls[0][0] as CompressWorkerResultMessage;
    expect(message.status).toBe("unsafe-dimensions");
  });

  it("formatを省略するとJPEG経路(compressJpegBufferToTarget)へルーティングされる", async () => {
    await sendMessage({
      id: "a",
      buffer: buildValidJpeg(800, 600),
      targetBytes: 1000,
    });

    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
    if (message.status === "done") {
      expect(message.jpegBuffer).toBeInstanceOf(ArrayBuffer);
    }
  });

  it("format:webpを指定するとWebP経路(compressWebpBufferToTarget)へルーティングされ、webp-doneを返す", async () => {
    // WebP用の寸法安全性チェックはformatに応じてreadDeclaredDimensions(bytes,'webp')を使うため、
    // ここではJPEGバイト列を渡すとwebpヘッダーとして解析できずunsafe-dimensionsになってしまう。
    // そのためWebPとして解析可能な最小のVP8Xバイト列を使う。
    function u24le(value: number): number[] {
      return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
    }
    function u32le(value: number): number[] {
      return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
    }
    function ascii(str: string): number[] {
      return Array.from(str, (ch) => ch.charCodeAt(0));
    }
    const vp8xPayload = [0x00, 0, 0, 0, ...u24le(799), ...u24le(599)];
    const chunk = [...ascii("VP8X"), ...u32le(vp8xPayload.length), ...vp8xPayload];
    const bytes = new Uint8Array([
      ...ascii("RIFF"),
      ...u32le(4 + chunk.length),
      ...ascii("WEBP"),
      ...chunk,
    ]);

    await sendMessage({
      id: "a",
      buffer: bytes.buffer,
      targetBytes: 1000,
      format: "webp",
    });

    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("webp-done");
    if (message.status === "webp-done") {
      expect(message.webpBuffer).toBeInstanceOf(ArrayBuffer);
    }
  });

  it("アニメーションWebPはcreateImageBitmapへ渡す前にunsupported-animationとして拒否する", async () => {
    function u24le(value: number): number[] {
      return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
    }
    function u32le(value: number): number[] {
      return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
    }
    function ascii(str: string): number[] {
      return Array.from(str, (ch) => ch.charCodeAt(0));
    }
    // VP8Xのanimation flag(bit1)を立てる
    const vp8xPayload = [0x02, 0, 0, 0, ...u24le(799), ...u24le(599)];
    const chunk = [...ascii("VP8X"), ...u32le(vp8xPayload.length), ...vp8xPayload];
    const bytes = new Uint8Array([
      ...ascii("RIFF"),
      ...u32le(4 + chunk.length),
      ...ascii("WEBP"),
      ...chunk,
    ]);

    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: bytes.buffer, targetBytes: 1000, format: "webp" });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsupported-animation" });
  });

  it("壊れたWebP(RIFF終端不一致)はcreateImageBitmapへ渡す前にmalformed-webpとして拒否する", async () => {
    function u32le(value: number): number[] {
      return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
    }
    function ascii(str: string): number[] {
      return Array.from(str, (ch) => ch.charCodeAt(0));
    }
    // riffSizeを実際のバッファ長と一致しない値にする(壊れたRIFF全体サイズ)
    const bytes = new Uint8Array([...ascii("RIFF"), ...u32le(9999), ...ascii("WEBP"), 1, 2, 3, 4]);

    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: bytes.buffer, targetBytes: 1000, format: "webp" });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "malformed-webp" });
  });

  it("RIFF/WEBPシグネチャすら無いバイト列(not-webp)もmalformed-webpとして安全に拒否する", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({ id: "a", buffer: bytes.buffer, targetBytes: 1000, format: "webp" });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "malformed-webp" });
  });

  it("宣言寸法と実デコード寸法が一致しない場合、dimension-mismatchとして拒否する", async () => {
    // 宣言は800x600だが、createImageBitmapのスタブは常に800x600を返す設定のため、
    // ここではスタブを一時的に別寸法へ差し替えて不一致を再現する
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(4000, 4000))),
    );

    await sendMessage({
      id: "a",
      buffer: buildValidJpeg(800, 600),
      targetBytes: 1000,
      format: "jpeg",
    });

    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "dimension-mismatch" });
  });

  it("1件目がunsafe-dimensionsで拒否された後も、2件目は正常に処理される(1件の失敗が他を止めない)", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(4), targetBytes: 1000, format: "jpeg" });
    await sendMessage({
      id: "b",
      buffer: buildValidJpeg(800, 600),
      targetBytes: 1000,
      format: "jpeg",
    });

    const messages = resultMessages(postMessageSpy);
    expect(messages.find((m) => m.id === "a")?.status).toBe("unsafe-dimensions");
    expect(messages.find((m) => m.id === "b")?.status).toBe("done");
  });
});
