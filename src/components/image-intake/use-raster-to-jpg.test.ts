import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRasterConvertClient } from "./raster-convert-client";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import { eligibilityFor, useRasterToJpg } from "./use-raster-to-jpg";
import { ja } from "../../i18n/dictionaries/ja";
import type { RasterConvertClient, RasterConvertOutcome } from "./raster-convert-client";
import type { IntakeItem } from "./types";

vi.mock("./raster-convert-client", () => ({
  createRasterConvertClient: vi.fn(),
}));

interface ControllableClient {
  client: RasterConvertClient;
  enqueuedIds: string[];
  start(id: string): void;
  resolve(id: string, outcome: RasterConvertOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
  destroyMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  const resolvers = new Map<string, (outcome: RasterConvertOutcome) => void>();
  const starters = new Map<string, () => void>();
  const enqueuedIds: string[] = [];

  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const destroyMock = vi.fn();

  const client: RasterConvertClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      if (callbacks?.onStart) starters.set(task.id, callbacks.onStart);
      return new Promise<RasterConvertOutcome>((resolve) => {
        resolvers.set(task.id, resolve);
      });
    }),
    cancel: cancelMock,
    cancelAll: cancelAllMock,
    destroy: destroyMock,
  };

  return {
    client,
    enqueuedIds,
    start(id) {
      starters.get(id)?.();
    },
    resolve(id, outcome) {
      resolvers.get(id)?.(outcome);
      resolvers.delete(id);
    },
    cancelMock,
    cancelAllMock,
    destroyMock,
  };
}

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
function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}
function ihdrData(width: number, height: number): number[] {
  return [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0];
}
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildPngBytes(width: number, height: number, options: { animated?: boolean } = {}) {
  const chunks = [pngChunk("IHDR", ihdrData(width, height))];
  if (options.animated) chunks.push(pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]));
  chunks.push(pngChunk("IDAT", [1, 2, 3, 4]));
  chunks.push(pngChunk("IEND", []));
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]);
}

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
function buildWebpBytes(width: number, height: number, options: { animated?: boolean } = {}) {
  const chunk = vp8xChunk(width, height, options.animated ?? false);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

function makePngItem(
  overrides: {
    id?: string;
    fileName?: string;
    width?: number;
    height?: number;
    animated?: boolean;
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.png";
  const bytes = buildPngBytes(overrides.width ?? 500, overrides.height ?? 500, {
    animated: overrides.animated ?? false,
  });
  const file = new File([bytes], fileName, { type: "image/png" });
  return {
    id: overrides.id ?? "item-1",
    file,
    objectUrl: "blob:mock-original",
    extension: "png",
    detectedFormat: "png",
    mimeType: "image/png",
    extensionMismatch: false,
    status: {
      kind: "ready",
      dimensions: { width: overrides.width ?? 500, height: overrides.height ?? 500 },
    },
  };
}

function makeWebpItem(
  overrides: {
    id?: string;
    fileName?: string;
    width?: number;
    height?: number;
    animated?: boolean;
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.webp";
  const bytes = buildWebpBytes(overrides.width ?? 500, overrides.height ?? 500, {
    animated: overrides.animated ?? false,
  });
  const file = new File([bytes], fileName, { type: "image/webp" });
  return {
    id: overrides.id ?? "item-1",
    file,
    objectUrl: "blob:mock-original",
    extension: "webp",
    detectedFormat: "webp",
    mimeType: "image/webp",
    extensionMismatch: false,
    status: {
      kind: "ready",
      dimensions: { width: overrides.width ?? 500, height: overrides.height ?? 500 },
    },
  };
}

function makeAvifItem(
  overrides: {
    id?: string;
    fileName?: string;
    width?: number;
    height?: number;
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.avif";
  // ensureAnimationCheckStartedはAVIFではfile内容を再読み込みしないため、中身は問わない
  // (intake側use-image-intake.tsのavifPreflightが既にispe検証を済ませている前提)。
  const file = new File([new Uint8Array([0, 0, 0, 0])], fileName, { type: "image/avif" });
  return {
    id: overrides.id ?? "item-1",
    file,
    objectUrl: "blob:mock-original",
    extension: "avif",
    detectedFormat: "avif",
    mimeType: "image/avif",
    extensionMismatch: false,
    status: {
      kind: "ready",
      dimensions: { width: overrides.width ?? 500, height: overrides.height ?? 500 },
    },
  };
}

function makeJpegItem(id = "item-1"): IntakeItem {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", {
    type: "image/jpeg",
  });
  return {
    id,
    file,
    objectUrl: "blob:mock-original",
    extension: "jpg",
    detectedFormat: "jpeg",
    mimeType: "image/jpeg",
    extensionMismatch: false,
    status: { kind: "ready", dimensions: { width: 500, height: 500 } },
  };
}

function makeHeicPendingItem(id = "item-1"): IntakeItem {
  const file = new File([new Uint8Array([1, 2, 3])], "photo.heic", { type: "image/heic" });
  return {
    id,
    file,
    objectUrl: "blob:mock-original",
    extension: "heic",
    detectedFormat: "heic",
    mimeType: "image/heic",
    extensionMismatch: false,
    status: { kind: "heic-pending" },
  };
}

function makeNotReadyItem(id = "item-1"): IntakeItem {
  const file = new File([new Uint8Array(8)], "photo.png", { type: "image/png" });
  return {
    id,
    file,
    objectUrl: "blob:mock-original",
    extension: "png",
    detectedFormat: null,
    mimeType: "image/png",
    extensionMismatch: false,
    status: { kind: "analyzing" },
  };
}

describe("eligibilityFor", () => {
  it("非対応ブラウザでは常にunsupported-browserを返す", () => {
    expect(eligibilityFor(makePngItem(), "png", false)).toEqual({ kind: "unsupported-browser" });
  });

  it("sourceFormatに一致するアイテムはanimationCheck省略時は常にnot-ready(非同期チェック待ち)を返す", () => {
    expect(eligibilityFor(makePngItem(), "png", true)).toEqual({ kind: "not-ready" });
  });

  it("sourceFormatに一致するアイテムはanimationCheck='ready'でready(source有り)を返す", () => {
    const result = eligibilityFor(makePngItem(), "png", true, "ready");
    expect(result.kind).toBe("ready");
  });

  it("animationCheck='unsupported-animation'でunsupported-animationを返す", () => {
    expect(eligibilityFor(makePngItem(), "png", true, "unsupported-animation")).toEqual({
      kind: "unsupported-animation",
    });
  });

  it("animationCheck='unsafe-dimensions'でunsafe-dimensionsを返す", () => {
    expect(eligibilityFor(makePngItem(), "png", true, "unsafe-dimensions")).toEqual({
      kind: "unsafe-dimensions",
    });
  });

  it("sourceFormat='webp'ページでPNGアイテムはunsupported-formatを返す(逆も同様)", () => {
    expect(eligibilityFor(makePngItem(), "webp", true)).toEqual({ kind: "unsupported-format" });
    expect(eligibilityFor(makeWebpItem(), "png", true)).toEqual({ kind: "unsupported-format" });
  });

  it("sourceFormat='avif'では、animationCheckを一切渡さなくてもsourceが揃った時点でreadyを返す(state不要)", () => {
    // AVIFはintake側(use-image-intake.ts)で既にavis/ispe検証済みのため、この関数はanimationCheckに
    // 依存せず直ちにreadyを返せる。animationCheckを渡さない=PNG/WebPなら"not-ready"になる状況でも、
    // AVIFはreadyになることを固定する(useRasterToJpg — AVIF pre-decode safetyのregression参照)。
    const result = eligibilityFor(makeAvifItem(), "avif", true);
    expect(result.kind).toBe("ready");
  });

  it("sourceFormat='avif'では、animationCheck引数が指定されても無視してreadyを返す", () => {
    expect(eligibilityFor(makeAvifItem(), "avif", true, "unsupported-animation").kind).toBe(
      "ready",
    );
  });

  it("JPEGはどちらのsourceFormatでもunsupported-formatを返す", () => {
    expect(eligibilityFor(makeJpegItem(), "png", true)).toEqual({ kind: "unsupported-format" });
    expect(eligibilityFor(makeJpegItem(), "webp", true)).toEqual({ kind: "unsupported-format" });
  });

  it("HEICパイプライン中(変換待ち等)もunsupported-formatを返す", () => {
    expect(eligibilityFor(makeHeicPendingItem(), "png", true)).toEqual({
      kind: "unsupported-format",
    });
  });

  it("解析中等はnot-readyを返す", () => {
    expect(eligibilityFor(makeNotReadyItem(), "png", true)).toEqual({ kind: "not-ready" });
  });
});

describe("useRasterToJpg", () => {
  let controllable: ControllableClient;

  beforeEach(() => {
    controllable = createControllableClient();
    vi.mocked(createRasterConvertClient).mockReturnValue(controllable.client);
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
      },
    );
    vi.stubGlobal("createImageBitmap", vi.fn());
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:mock-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("通常PNG: 非同期チェック後にreadyになり、変換フローが動作する(quality preset・背景色反映)", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem({ fileName: "photo.png" });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => {
      result.current.startConversion(item, "light", { r: 10, g: 20, b: 30 });
    });

    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(controllable.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 0.65,
        sourceFormat: "png",
        background: { r: 10, g: 20, b: 30 },
      }),
      expect.anything(),
    );

    act(() => controllable.start(item.id));
    expect(result.current.jobs[item.id].status.kind).toBe("processing");

    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 500,
        height: 500,
        quality: 0.65,
        elapsedMs: 42,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.outputFileName).toBe("photo.jpg");
      expect(job.status.result.qualityPreset).toBe("light");
      expect(job.status.result.background).toEqual({ r: 10, g: 20, b: 30 });
      expect(job.status.result.blob.type).toBe("image/jpeg");
    }
  });

  it("通常WebP: 非同期チェック後にreadyになり、変換フローが動作する", async () => {
    const { result } = renderHook(() => useRasterToJpg("webp", ja.ui.rasterToJpg.panel.errors));
    const item = makeWebpItem({ fileName: "photo.webp" });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(controllable.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 0.8, sourceFormat: "webp" }),
      expect.anything(),
    );

    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 500,
        height: 500,
        quality: 0.8,
        elapsedMs: 10,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.outputFileName).toBe("photo.jpg");
    }
  });

  it("アニメーションPNGはeligibilityForがunsupported-animationになりstartConversionは何もしない", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem({ animated: true });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => {
      expect(result.current.eligibilityFor(item)).toEqual({ kind: "unsupported-animation" });
    });

    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    expect(result.current.jobs[item.id]).toBeUndefined();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("アニメーションWebPはeligibilityForがunsupported-animationになりstartConversionは何もしない", async () => {
    const { result } = renderHook(() => useRasterToJpg("webp", ja.ui.rasterToJpg.panel.errors));
    const item = makeWebpItem({ animated: true });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => {
      expect(result.current.eligibilityFor(item)).toEqual({ kind: "unsupported-animation" });
    });

    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    expect(result.current.jobs[item.id]).toBeUndefined();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("Workerがunsupported-animationを返した場合(フック側判定を迂回した想定)、固定文言のerrorになる", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "unsupported-animation" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsupported-animation",
    });
  });

  it("Workerがmalformed-sourceを返した場合、decode-failedの固定文言のerrorになる", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "malformed-source" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "decode-failed",
    });
  });

  it("Workerがunsafe-dimensionsを返した場合、固定文言のerrorになる", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "unsafe-dimensions" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsafe-dimensions",
    });
  });

  it("Workerがdimension-mismatchを返した場合、decode-failedの固定文言のerrorになる", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "dimension-mismatch" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "decode-failed",
    });
  });

  it("Workerがunsupported-encoderを返した場合、固定文言のerrorになる(暗黙に別形式へ変換しない)", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "unsupported-encoder" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsupported-encoder",
    });
  });

  it("Workerがtimeoutを返した場合、固定文言のerrorになる", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "timeout" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({ kind: "error", reason: "timeout" });
  });

  it("Workerがerrorを返した場合、固定文言(encode-failed)のerrorになる(内部メッセージを画面に出さない)", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() =>
      controllable.resolve(item.id, { status: "error", message: "内部の技術的なエラー詳細" }),
    );

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    const status = result.current.jobs[item.id].status;
    expect(status).toMatchObject({ kind: "error", reason: "encode-failed" });
    if (status.kind === "error") {
      expect(status.message).not.toContain("内部の技術的なエラー詳細");
    }
  });

  it("1件が失敗しても、別アイテムの処理には影響しない", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const itemA = makePngItem({ id: "a", fileName: "a.png" });
    const itemB = makePngItem({ id: "b", fileName: "b.png" });

    act(() => {
      result.current.eligibilityFor(itemA);
    });
    act(() => {
      result.current.eligibilityFor(itemB);
    });
    await waitFor(() => {
      expect(result.current.eligibilityFor(itemA).kind).toBe("ready");
      expect(result.current.eligibilityFor(itemB).kind).toBe("ready");
    });

    act(() => result.current.startConversion(itemA, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toContain("a"));
    act(() => controllable.resolve("a", { status: "malformed-source" }));

    act(() => result.current.startConversion(itemB, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toContain("b"));
    act(() =>
      controllable.resolve("b", {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 100,
        height: 100,
        quality: 0.8,
        elapsedMs: 10,
      }),
    );

    await waitFor(() => {
      expect(result.current.jobs.a.status.kind).toBe("error");
      expect(result.current.jobs.b.status.kind).toBe("done");
    });
  });

  it("待機中のキャンセルはcancelledになる", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();
    controllable.cancelMock.mockReturnValue(true);

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => result.current.cancelConversion(item.id));

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id].status.kind).toBe("cancelled");
  });

  it("removeJobはWorkerのcancelとObject URLの解放を行い、ジョブを削除する", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    expect(result.current.jobs[item.id]).toBeDefined();

    act(() => result.current.removeJob(item.id));

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id]).toBeUndefined();
  });

  it("clearJobsはcancelAllとrevokeAllを行い、全ジョブを消去する", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const itemA = makePngItem({ id: "a", fileName: "a.png" });
    const itemB = makePngItem({ id: "b", fileName: "b.png" });

    act(() => {
      result.current.eligibilityFor(itemA);
    });
    act(() => {
      result.current.eligibilityFor(itemB);
    });
    await waitFor(() => {
      expect(result.current.eligibilityFor(itemA).kind).toBe("ready");
      expect(result.current.eligibilityFor(itemB).kind).toBe("ready");
    });

    act(() => {
      result.current.startConversion(itemA, "standard", DEFAULT_RASTER_BACKGROUND);
      result.current.startConversion(itemB, "standard", DEFAULT_RASTER_BACKGROUND);
    });

    act(() => result.current.clearJobs());

    expect(controllable.cancelAllMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs).toEqual({});
  });

  it("アンマウント時にdestroyが呼ばれる", () => {
    const { unmount } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    unmount();
    expect(controllable.destroyMock).toHaveBeenCalledTimes(1);
  });

  it("AVIF: intake側で既に安全性検証済みのため、file.arrayBuffer()を再読み込みせずreadyになる", async () => {
    const { result } = renderHook(() => useRasterToJpg("avif", ja.ui.rasterToJpg.panel.errors));
    const item = makeAvifItem({ fileName: "photo.avif" });
    const arrayBufferSpy = vi.spyOn(item.file, "arrayBuffer");

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("AVIF: eligibilityForを1回呼ぶだけで(再レンダーや非同期チェックの完了を待たずに)即座にreadyを返す", () => {
    // PNG/WebPはensureAnimationCheckStarted(非同期)の結果がanimationChecks stateへ反映されるまで
    // "not-ready"のままで、そのstate更新を反映した再レンダー後に初めて"ready"になる(waitForが
    // 必要な理由)。AVIFはstateに一切依存しないため、act()やwaitForを介さず、同一tick内の
    // 1回の呼び出しだけでreadyになることを固定する。render中にeligibilityForを呼んでも
    // setState(=次のレンダーを予約する副作用)を一切引き起こさないことの直接的な検証でもある。
    const { result } = renderHook(() => useRasterToJpg("avif", ja.ui.rasterToJpg.panel.errors));
    const item = makeAvifItem({ fileName: "photo.avif" });

    const eligibility = result.current.eligibilityFor(item);

    expect(eligibility.kind).toBe("ready");
  });

  it("AVIF: readyから通常どおり変換フローが動作する(quality preset・背景色反映)", async () => {
    const { result } = renderHook(() => useRasterToJpg("avif", ja.ui.rasterToJpg.panel.errors));
    const item = makeAvifItem({ fileName: "photo.avif" });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => {
      result.current.startConversion(item, "high", { r: 1, g: 2, b: 3 });
    });

    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(controllable.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 0.9,
        sourceFormat: "avif",
        background: { r: 1, g: 2, b: 3 },
      }),
      expect.anything(),
    );

    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 500,
        height: 500,
        quality: 0.9,
        elapsedMs: 10,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
  });

  it("AVIF: Workerがinput-too-largeを返した場合(intake側チェックをすり抜けた場合の最終防御)、専用文言のerrorになる", async () => {
    const { result } = renderHook(() => useRasterToJpg("avif", ja.ui.rasterToJpg.panel.errors));
    const item = makeAvifItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "input-too-large" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "input-too-large",
    });
  });

  it("Worker等が非対応の環境ではisSupportedがfalseになり、startConversionは何もしない", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("Worker", undefined);

    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    expect(result.current.isSupported).toBe(false);

    const item = makePngItem();
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));

    expect(result.current.jobs[item.id]).toBeUndefined();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });
});

/**
 * startConversionは`await source.blob.arrayBuffer()` → `await client.enqueue(...)`という
 * キャンセル不能な非同期境界を2つまたぐ。その待機中にremoveJob/clearJobs/同一itemへの
 * 再変換が起きても、stale化した処理がenqueueを呼んだり、削除済みitemのjob/Object URLを
 * 復活させたり、新しい変換を上書きしたりしないことを、arrayBufferの解決タイミングを
 * 手動で制御して検証する。
 */
describe("useRasterToJpg — arrayBuffer待ち中のrace", () => {
  let controllable: ControllableClient;
  let arrayBufferSpy: ReturnType<typeof vi.spyOn>;
  let pendingResolvers: Array<(buffer: ArrayBuffer) => void>;

  beforeEach(() => {
    controllable = createControllableClient();
    vi.mocked(createRasterConvertClient).mockReturnValue(controllable.client);
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
      },
    );
    vi.stubGlobal("createImageBitmap", vi.fn());
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:mock-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    pendingResolvers = [];
  });

  afterEach(() => {
    arrayBufferSpy?.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** eligibilityForが"ready"になるまで、通常のarrayBuffer実装(モック前)でアニメーション判定を進める */
  async function makeReadyItem(result: { current: ReturnType<typeof useRasterToJpg> }) {
    const item = makePngItem();
    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    return item;
  }

  /**
   * ここから先のFile.prototype.arrayBuffer()呼び出しだけを制御下に置く
   * (アニメーション判定は既に完了させた後にインストールするため影響しない)。
   */
  function installControlledArrayBuffer() {
    arrayBufferSpy = vi
      .spyOn(File.prototype, "arrayBuffer")
      .mockImplementation(
        () => new Promise<ArrayBuffer>((resolve) => pendingResolvers.push(resolve)),
      );
  }

  it("remove中にarrayBufferがresolveしてもenqueueされない", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = await makeReadyItem(result);

    installControlledArrayBuffer();
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    expect(pendingResolvers).toHaveLength(1);

    act(() => result.current.removeJob(item.id));

    act(() => pendingResolvers[0](new ArrayBuffer(4)));
    await Promise.resolve();
    await Promise.resolve();

    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("clearAll後にenqueueされない", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = await makeReadyItem(result);

    installControlledArrayBuffer();
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    expect(pendingResolvers).toHaveLength(1);

    act(() => result.current.clearJobs());

    act(() => pendingResolvers[0](new ArrayBuffer(4)));
    await Promise.resolve();
    await Promise.resolve();

    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("stale処理はObject URLを作らない(remove中にarrayBufferがresolveしても新規URLが生成されない)", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = await makeReadyItem(result);

    installControlledArrayBuffer();
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));

    act(() => result.current.removeJob(item.id));
    const createCallsBeforeResolve = vi.mocked(URL.createObjectURL).mock.calls.length;

    act(() => pendingResolvers[0](new ArrayBuffer(4)));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(createCallsBeforeResolve);
  });

  it("stale処理はsetJobsでjobを復活させない(remove後、jobsに現れない)", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = await makeReadyItem(result);

    installControlledArrayBuffer();
    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));

    act(() => result.current.removeJob(item.id));
    expect(result.current.jobs[item.id]).toBeUndefined();

    act(() => pendingResolvers[0](new ArrayBuffer(4)));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.jobs[item.id]).toBeUndefined();
  });

  it("古いconversionが新しいreconversionを上書きしない(先に発行した方が後で解決しても、最新のjobは維持される)", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = await makeReadyItem(result);

    installControlledArrayBuffer();

    // 1回目の変換開始(以後stale化される想定)
    act(() => result.current.startConversion(item, "light", DEFAULT_RASTER_BACKGROUND));
    expect(pendingResolvers).toHaveLength(1);

    // 1回目のarrayBuffer待機中に、同じitemへ再変換を開始する(2回目)
    act(() => result.current.startConversion(item, "high", DEFAULT_RASTER_BACKGROUND));
    expect(pendingResolvers).toHaveLength(2);

    // 古い(1回目の)arrayBufferが後から解決しても、enqueueは呼ばれない
    act(() => pendingResolvers[0](new ArrayBuffer(4)));
    await Promise.resolve();
    await Promise.resolve();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();

    // 新しい(2回目の)arrayBufferが解決すると、そちらだけがenqueueされる
    act(() => pendingResolvers[1](new ArrayBuffer(4)));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(vi.mocked(controllable.client.enqueue).mock.calls[0][0]).toMatchObject({
      quality: 0.9,
    });

    act(() => controllable.start(item.id));
    act(() =>
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 100,
        height: 100,
        quality: 0.9,
        elapsedMs: 5,
      }),
    );

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.qualityPreset).toBe("high");
    }
  });

  it("enqueue待ち中にremoveされた場合も、後からWorkerが応答してjobを復活させない", async () => {
    const { result } = renderHook(() => useRasterToJpg("png", ja.ui.rasterToJpg.panel.errors));
    const item = await makeReadyItem(result);

    act(() => result.current.startConversion(item, "standard", DEFAULT_RASTER_BACKGROUND));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => result.current.removeJob(item.id));
    expect(result.current.jobs[item.id]).toBeUndefined();

    // removeJob後にWorkerからdone応答が届いても、stale化されているため反映されない
    act(() =>
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 100,
        height: 100,
        quality: 0.8,
        elapsedMs: 5,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.jobs[item.id]).toBeUndefined();
  });
});
