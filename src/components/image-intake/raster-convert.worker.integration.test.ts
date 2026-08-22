import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./raster-convert.worker";
import { MAX_AVIF_INPUT_BYTES } from "./avif-conversion-types";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import type {
  RasterConvertWorkerRequestMessage,
  RasterConvertWorkerResultMessage,
} from "./raster-convert.worker";

/**
 * self.onmessage(Worker全体のメッセージルーティング)を通した統合テスト。
 * 純粋関数レベルのテスト(raster-convert.worker.test.ts / apng-detection.test.ts /
 * webp-animation-detection.test.ts / decode-safety.test.ts)では検証できない、
 * 「アニメーション判定・寸法安全性検証がcreateImageBitmap前に、入力形式(PNG/WebP)ごとに
 * 正しく行われること」を確認する(png-to-webp.worker.integration.test.tsと同じ設計)。
 */

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}
function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}

// --- PNGフィクスチャ(png-to-webp.worker.integration.test.tsと同じ組み立て方) ---
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

// --- WebPフィクスチャ(webp-animation-detection.test.tsと同じ組み立て方) ---
function riffHeader(payloadLength: number): number[] {
  return [...ascii("RIFF"), ...u32le(4 + payloadLength), ...ascii("WEBP")];
}
function webpChunk(fourCC: string, payload: number[]): number[] {
  const padding = payload.length % 2 === 1 ? [0] : [];
  return [...ascii(fourCC), ...u32le(payload.length), ...payload, ...padding];
}
function vp8xChunk(width: number, height: number, animationFlag: boolean): number[] {
  const flags = animationFlag ? 0x02 : 0x00;
  const payload = [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  return webpChunk("VP8X", payload);
}

function buildStaticWebp(width: number, height: number): ArrayBuffer {
  const chunk = vp8xChunk(width, height, false);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]).buffer;
}
function buildAnimatedWebp(width: number, height: number): ArrayBuffer {
  const chunk = vp8xChunk(width, height, true);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]).buffer;
}

// --- AVIFフィクスチャ(avif-isobmff.test.tsと同じボックス組み立て方) ---
function ascii4(type: string): number[] {
  return type.split("").map((c) => c.charCodeAt(0));
}
function box(type: string, payload: number[]): number[] {
  const totalSize = 8 + payload.length;
  return [...u32be(totalSize), ...ascii4(type), ...payload];
}
function ftypBox(majorBrand: string, compatibleBrands: string[] = []): number[] {
  const payload = [...ascii4(majorBrand), ...u32be(0), ...compatibleBrands.flatMap(ascii4)];
  return box("ftyp", payload);
}
function ispePayload(width: number, height: number): number[] {
  return [...u32be(0), ...u32be(width), ...u32be(height)];
}
function metaPayload(children: number[]): number[] {
  return [...u32be(0), ...children];
}
/** meta > iprp > ipco > ispe(複数可)という一般的な形のAVIF構造。ftyp+meta本体を組み立てる */
function buildAvif(
  candidates: Array<{ width: number; height: number }>,
  options: { animated?: boolean } = {},
): ArrayBuffer {
  const compatibleBrands = options.animated ? ["avis", "msf1"] : ["mif1", "miaf"];
  const ftyp = ftypBox("avif", compatibleBrands);
  const ispeBoxes = candidates.flatMap((c) => box("ispe", ispePayload(c.width, c.height)));
  const ipco = box("ipco", ispeBoxes);
  const iprp = box("iprp", ipco);
  const meta = box("meta", metaPayload(iprp));
  return new Uint8Array([...ftyp, ...meta]).buffer;
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
    return { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  }
  async convertToBlob(opts: { type: string; quality?: number }) {
    return {
      size: 10,
      type: opts.type,
      arrayBuffer: async () => new ArrayBuffer(10),
    } as unknown as Blob;
  }
}

async function sendMessage(message: RasterConvertWorkerRequestMessage): Promise<void> {
  const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
  await handler({ data: message } as MessageEvent);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function resultMessages(
  postMessageSpy: ReturnType<typeof vi.spyOn>,
): RasterConvertWorkerResultMessage[] {
  return postMessageSpy.mock.calls
    .map((call: unknown[]) => call[0] as RasterConvertWorkerResultMessage)
    .filter((message: RasterConvertWorkerResultMessage) => message.type === "result");
}

describe("raster-convert.worker self.onmessage", () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    // 宣言寸法(このファイルのテストで使うフィクスチャは800x600)と一致させ、
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
    await sendMessage({
      id: "a",
      buffer: buildPng(800, 600),
      sourceFormat: "png",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
    if (message.status === "done") {
      expect(message.jpegBuffer).toBeInstanceOf(ArrayBuffer);
      expect(message.quality).toBe(0.8);
    }
  });

  it("通常WebPは正常にdoneを返す", async () => {
    await sendMessage({
      id: "a",
      buffer: buildStaticWebp(800, 600),
      sourceFormat: "webp",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
  });

  it("APNGはcreateImageBitmapへ渡す前にunsupported-animationとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildPng(800, 600, { animated: true }),
      sourceFormat: "png",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsupported-animation" });
  });

  it("アニメーションWebPはcreateImageBitmapへ渡す前にunsupported-animationとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildAnimatedWebp(800, 600),
      sourceFormat: "webp",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsupported-animation" });
  });

  it("壊れたPNG(先頭チャンクがIHDRではない)はcreateImageBitmapへ渡す前にmalformed-sourceとして拒否する", async () => {
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...pngChunk("IDAT", [1, 2, 3]),
      ...pngChunk("IEND", []),
    ]);

    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: bytes.buffer,
      sourceFormat: "png",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "malformed-source" });
  });

  it("RIFF/WEBPシグネチャの無いバイト列はcreateImageBitmapへ渡す前にmalformed-sourceとして拒否する", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: bytes.buffer,
      sourceFormat: "webp",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "malformed-source" });
  });

  it("宣言寸法が最大辺を超える場合、createImageBitmapへ渡す前にunsafe-dimensionsとして拒否する(PNG)", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildPng(20000, 20000),
      sourceFormat: "png",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsafe-dimensions" });
  });

  it("宣言寸法と実デコード寸法が一致しない場合、dimension-mismatchとして拒否する", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(4000, 4000))),
    );

    await sendMessage({
      id: "a",
      buffer: buildPng(800, 600),
      sourceFormat: "png",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "dimension-mismatch" });
  });

  it("quality 1.0はcreateImageBitmapへ渡す前にinvalid-qualityとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildPng(800, 600),
      sourceFormat: "png",
      quality: 1.0,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "invalid-quality" });
  });

  it("許可されていない任意の中間値(0.75)はcreateImageBitmapへ渡す前にinvalid-qualityとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildStaticWebp(800, 600),
      sourceFormat: "webp",
      quality: 0.75,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "invalid-quality" });
  });

  it("不正なsourceFormat(png/webp以外)はcreateImageBitmapへ渡す前にerrorとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildPng(800, 600),
      sourceFormat: "gif" as unknown as "png",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("error");
  });

  it.each([
    { r: -1, g: 0, b: 0 },
    { r: 256, g: 0, b: 0 },
    { r: 1.5, g: 0, b: 0 },
    { r: NaN, g: 0, b: 0 },
  ])("不正な背景色%sはcreateImageBitmapへ渡す前にerrorとして拒否する", async (background) => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildPng(800, 600),
      sourceFormat: "png",
      quality: 0.8,
      background,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("error");
  });

  it("通常AVIFは正常にdoneを返す(ispe候補が寸法安全上限内)", async () => {
    await sendMessage({
      id: "a",
      buffer: buildAvif([{ width: 800, height: 600 }]),
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
  });

  it("複数ispe候補(補助画像等)を持つAVIFも、全候補が安全なら正常に処理される", async () => {
    await sendMessage({
      id: "a",
      buffer: buildAvif([
        { width: 800, height: 600 },
        { width: 160, height: 120 }, // サムネイル相当
      ]),
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
  });

  it("avisブランドを持つAVIF(image sequence)はcreateImageBitmapへ渡す前にunsupported-animationとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildAvif([{ width: 800, height: 600 }], { animated: true }),
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsupported-animation" });
  });

  it("ftypを持たないバイト列のAVIFはcreateImageBitmapへ渡す前にmalformed-sourceとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer,
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "malformed-source" });
  });

  it("ispe候補が1件も無いAVIFはcreateImageBitmapへ渡す前にunsafe-dimensionsとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildAvif([]),
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsafe-dimensions" });
  });

  it("1件でも安全上限を超えるispe候補があるAVIFは、他の候補が安全でもcreateImageBitmapへ渡す前にunsafe-dimensionsとして拒否する(合成せず個別に検証する設計の統合テスト)", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    await sendMessage({
      id: "a",
      buffer: buildAvif([
        { width: 800, height: 600 }, // 安全な候補
        { width: 20000, height: 20000 }, // 安全上限(maxDimension=16384)を超える候補
      ]),
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsafe-dimensions" });
  });

  it("AVIFはcreateImageBitmap後の実寸法が安全上限を超える場合、unsafe-dimensionsとして拒否する(ispe候補自体は安全な場合)", async () => {
    // clap/irot/imir等のtransformative propertyにより、ispeの宣言寸法とdecode後の実寸法が
    // 食い違うvalid fileを想定。ispe候補は安全(800x600)だが、decode結果は安全上限を超える。
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(20000, 100))),
    );
    await sendMessage({
      id: "a",
      buffer: buildAvif([{ width: 800, height: 600 }]),
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "unsafe-dimensions" });
  });

  it("圧縮ファイル自体がMAX_AVIF_INPUT_BYTESを超えるAVIFは、parse/createImageBitmapへ渡す前にinput-too-largeとして拒否する", async () => {
    const bitmapSpy = vi.mocked(createImageBitmap);
    const oversized = new ArrayBuffer(MAX_AVIF_INPUT_BYTES + 1);
    await sendMessage({
      id: "a",
      buffer: oversized,
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    expect(bitmapSpy).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", type: "result", status: "input-too-large" });
  });

  it("AVIFのispe候補と一致しないcreateImageBitmap後の実寸法でも、安全上限内ならdimension-mismatchにせず正常に処理する(完全一致を要求しない)", async () => {
    // ispe候補は800x600だが、decode結果は400x300(例: cropプロパティ相当)。
    // 安全上限内であれば、PNG/WebPと違いdimension-mismatchとして拒否しない。
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(400, 300))),
    );
    await sendMessage({
      id: "a",
      buffer: buildAvif([{ width: 800, height: 600 }]),
      sourceFormat: "avif",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
  });

  it("1件目がアニメーションWebPで拒否された後も、2件目(通常PNG)は正常に処理される(1件の失敗が他を止めない)", async () => {
    await sendMessage({
      id: "a",
      buffer: buildAnimatedWebp(800, 600),
      sourceFormat: "webp",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });
    await sendMessage({
      id: "b",
      buffer: buildPng(800, 600),
      sourceFormat: "png",
      quality: 0.8,
      background: DEFAULT_RASTER_BACKGROUND,
    });

    const messages = resultMessages(postMessageSpy);
    expect(messages.find((m) => m.id === "a")?.status).toBe("unsupported-animation");
    expect(messages.find((m) => m.id === "b")?.status).toBe("done");
  });
});
