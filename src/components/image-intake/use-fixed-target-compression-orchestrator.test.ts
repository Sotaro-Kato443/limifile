import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCompressionTarget } from "./compression-target";
import { createCompressionClient } from "./image-compression-client";
import { createPngCompressionClient } from "../png-compression/png-compression-client";
import { useFixedTargetCompressionOrchestrator } from "./use-fixed-target-compression-orchestrator";
import { ja } from "../../i18n/dictionaries/ja";
import type { CompressionClient, CompressOutcome } from "./image-compression-client";
import type { PngCompressionClient } from "../png-compression/png-compression-client";
import type { PngCompressionOutcome } from "../png-compression/png-compression-types";
import type { IntakeItem } from "./types";

vi.mock("./image-compression-client", () => ({
  createCompressionClient: vi.fn(),
}));
vi.mock("../png-compression/png-compression-client", () => ({
  createPngCompressionClient: vi.fn(),
  detectPngCompressionSupport: vi.fn(() => true),
}));

interface ControllableJpegClient {
  client: CompressionClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: CompressOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
}
function createControllableJpegClient(): ControllableJpegClient {
  const resolvers = new Map<string, (outcome: CompressOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const client: CompressionClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      callbacks?.onStart?.();
      return new Promise<CompressOutcome>((resolve) => resolvers.set(task.id, resolve));
    }),
    cancel: cancelMock,
    cancelAll: cancelAllMock,
    destroy: vi.fn(),
  };
  return {
    client,
    enqueuedIds,
    resolve(id, outcome) {
      resolvers.get(id)?.(outcome);
      resolvers.delete(id);
    },
    cancelMock,
    cancelAllMock,
  };
}

interface ControllablePngClient {
  client: PngCompressionClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: PngCompressionOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
}
function createControllablePngClient(): ControllablePngClient {
  const resolvers = new Map<string, (outcome: PngCompressionOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const client: PngCompressionClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      callbacks?.onStart?.();
      return new Promise<PngCompressionOutcome>((resolve) => resolvers.set(task.id, resolve));
    }),
    cancel: cancelMock,
    cancelAll: cancelAllMock,
    destroy: vi.fn(),
  };
  return {
    client,
    enqueuedIds,
    resolve(id, outcome) {
      resolvers.get(id)?.(outcome);
      resolvers.delete(id);
    },
    cancelMock,
    cancelAllMock,
  };
}

function makeJpegItem(id: string, fileName: string, fileSize = 900_000): IntakeItem {
  const file = new File([new Uint8Array(fileSize)], fileName, { type: "image/jpeg" });
  return {
    id,
    file,
    objectUrl: "blob:mock-original",
    extension: "jpg",
    detectedFormat: "jpeg",
    mimeType: "image/jpeg",
    extensionMismatch: false,
    status: { kind: "ready", dimensions: { width: 2000, height: 1000 } },
  };
}

function makePngItem(id: string, fileName: string): IntakeItem {
  const file = new File([new Uint8Array(8)], fileName, { type: "image/png" });
  return {
    id,
    file,
    objectUrl: "blob:mock-original",
    extension: "png",
    detectedFormat: "png",
    mimeType: "image/png",
    extensionMismatch: false,
    status: { kind: "ready", dimensions: { width: 500, height: 500 } },
  };
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}
function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}
/**
 * 500KBを超える有効なWebPを組み立てる。単純にゼロバイトでパディングするとRIFF全体サイズと
 * 実際のバッファ長が食い違いmalformed判定されるため、VP8Xの後ろに未知チャンク(JUNK)を追加して
 * RIFF宣言サイズと実サイズを一致させる(FixedTargetCompressionWorkbench.test.tsxと同じ手法)。
 */
function buildWebpBytes(width = 500, height = 500, totalSize = 900_000): number[] {
  const flags = [0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  const vp8x = [...ascii("VP8X"), ...u32le(flags.length), ...flags];
  const headerLen = 12 + vp8x.length;
  const paddingChunkOverhead = 8;
  let paddingDataLen = Math.max(0, totalSize - headerLen - paddingChunkOverhead);
  if (paddingDataLen % 2 !== 0) paddingDataLen += 1;
  const paddingChunk = [
    ...ascii("JUNK"),
    ...u32le(paddingDataLen),
    ...new Array(paddingDataLen).fill(0),
  ];
  const payload = [...vp8x, ...paddingChunk];
  return [...ascii("RIFF"), ...u32le(4 + payload.length), ...ascii("WEBP"), ...payload];
}

/** eligibilityFor(WebP)の非同期チェックを実際に通過できる、実物同等のWebPアイテムを作る */
function makeWebpItem(id: string, fileName: string): IntakeItem {
  const file = new File([new Uint8Array(buildWebpBytes())], fileName, { type: "image/webp" });
  return {
    id,
    file,
    objectUrl: "blob:mock-original",
    extension: "webp",
    detectedFormat: "webp",
    mimeType: "image/webp",
    extensionMismatch: false,
    status: { kind: "ready", dimensions: { width: 500, height: 500 } },
  };
}

/** 指定ファイルのarrayBuffer()の解決タイミングをテストコードから制御する */
function withControllableArrayBuffer(file: File) {
  let resolveFn: (buffer: ArrayBuffer) => void = () => {};
  let rejectFn: (error: unknown) => void = () => {};
  vi.spyOn(file, "arrayBuffer").mockImplementation(
    () =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
      }),
  );
  return {
    resolve: (buffer: ArrayBuffer = new ArrayBuffer(4)) => resolveFn(buffer),
    reject: (error: unknown) => rejectFn(error),
  };
}

function donePngOutcome(): Extract<PngCompressionOutcome, { status: "done" }> {
  return {
    status: "done",
    pngBuffer: new ArrayBuffer(4),
    pngType: "image/png",
    originalBytes: 10_000,
    outputBytes: 4_000,
    originalWidth: 500,
    originalHeight: 500,
    outputWidth: 500,
    outputHeight: 500,
    colorCount: 16,
    encodeCount: 3,
    originalReturned: false,
  };
}

function doneJpegOutcome(): Extract<CompressOutcome, { status: "done" }> {
  return {
    status: "done",
    jpegBuffer: new ArrayBuffer(4),
    width: 1000,
    height: 800,
    quality: 0.6,
    encodeCount: 4,
    resizeCount: 0,
    elapsedMs: 500,
  };
}

describe("useFixedTargetCompressionOrchestrator", () => {
  let jpeg: ControllableJpegClient;
  let png: ControllablePngClient;

  beforeEach(() => {
    jpeg = createControllableJpegClient();
    png = createControllablePngClient();
    vi.mocked(createCompressionClient).mockReturnValue(jpeg.client);
    vi.mocked(createPngCompressionClient).mockReturnValue(png.client);

    vi.stubGlobal("Worker", class {});
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
        getContext() {
          return { drawImage: vi.fn(), getImageData: vi.fn() };
        }
      },
    );
    vi.stubGlobal("createImageBitmap", vi.fn());
    vi.stubGlobal("ImageData", class {});
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:mock-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("実行中JPEGをarrayBuffer待機中にcancelすると、PNGが開始し、旧JPEGは後からenqueueされない", async () => {
    const { result } = renderHook(() =>
      useFixedTargetCompressionOrchestrator(
        ja.ui.compressionPanel.errors,
        ja.ui.pngCompression.panel.errors,
      ),
    );
    const itemA = makeJpegItem("a", "a.jpg");
    const itemB = makePngItem("b", "b.png");
    const buffer = withControllableArrayBuffer(itemA.file);
    const target = toCompressionTarget(500, "KB");

    act(() => {
      result.current.startCompression(itemA, target);
      result.current.startCompression(itemB, target);
    });

    expect(jpeg.enqueuedIds).toHaveLength(0);
    expect(png.enqueuedIds).toHaveLength(0);

    act(() => {
      result.current.cancelCompression("a");
    });

    await waitFor(() => expect(png.enqueuedIds).toEqual(["b"]));
    await waitFor(() => expect(result.current.jobs.b.job.status.kind).toBe("processing"));

    act(() => {
      buffer.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jpeg.enqueuedIds).toHaveLength(0);
  });

  it("実行中JPEGをarrayBuffer待機中にremoveJobすると、PNGが開始し、旧JPEGは復活せずAとBが同時processingにならない", async () => {
    const { result } = renderHook(() =>
      useFixedTargetCompressionOrchestrator(
        ja.ui.compressionPanel.errors,
        ja.ui.pngCompression.panel.errors,
      ),
    );
    const itemA = makeJpegItem("a", "a.jpg");
    const itemB = makePngItem("b", "b.png");
    const buffer = withControllableArrayBuffer(itemA.file);
    const target = toCompressionTarget(500, "KB");

    act(() => {
      result.current.startCompression(itemA, target);
      result.current.startCompression(itemB, target);
    });

    act(() => {
      result.current.removeJob("a");
    });

    await waitFor(() => expect(png.enqueuedIds).toEqual(["b"]));

    act(() => {
      buffer.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(jpeg.enqueuedIds).toHaveLength(0);
    expect(result.current.jobs.a).toBeUndefined();
    // Bのみがactiveであること(Aが復活してprocessingになっていない)
    await waitFor(() => expect(result.current.jobs.b.job.status.kind).toBe("processing"));
  });

  it("実行中JPEGのarrayBufferがrejectすると、Aはerrorになり、PNGへ進む", async () => {
    const { result } = renderHook(() =>
      useFixedTargetCompressionOrchestrator(
        ja.ui.compressionPanel.errors,
        ja.ui.pngCompression.panel.errors,
      ),
    );
    const itemA = makeJpegItem("a", "a.jpg");
    const itemB = makePngItem("b", "b.png");
    const buffer = withControllableArrayBuffer(itemA.file);
    const target = toCompressionTarget(500, "KB");

    act(() => {
      result.current.startCompression(itemA, target);
      result.current.startCompression(itemB, target);
    });

    act(() => {
      buffer.reject(new Error("read failed"));
    });

    await waitFor(() => expect(result.current.jobs.a.job.status.kind).toBe("error"));
    await waitFor(() => expect(png.enqueuedIds).toEqual(["b"]));
  });

  it("JPEG読み込み中にclearJobsすると、旧JPEG・PNGいずれも後から復活しない", async () => {
    const { result } = renderHook(() =>
      useFixedTargetCompressionOrchestrator(
        ja.ui.compressionPanel.errors,
        ja.ui.pngCompression.panel.errors,
      ),
    );
    const itemA = makeJpegItem("a", "a.jpg");
    const itemB = makePngItem("b", "b.png");
    const buffer = withControllableArrayBuffer(itemA.file);
    const target = toCompressionTarget(500, "KB");

    act(() => {
      result.current.startCompression(itemA, target);
      result.current.startCompression(itemB, target);
    });

    act(() => {
      result.current.clearJobs();
    });
    expect(result.current.jobs).toEqual({});

    act(() => {
      buffer.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(jpeg.enqueuedIds).toHaveLength(0);
    expect(png.enqueuedIds).toHaveLength(0);
    expect(result.current.jobs).toEqual({});
  });

  it("JPEG→PNG→WebP(同一クライアント)でも常に同時processingは最大1件", async () => {
    const { result } = renderHook(() =>
      useFixedTargetCompressionOrchestrator(
        ja.ui.compressionPanel.errors,
        ja.ui.pngCompression.panel.errors,
      ),
    );
    const itemA = makeJpegItem("a", "a.jpg");
    const itemB = makePngItem("b", "b.png");
    const itemC = makeWebpItem("c", "c.webp");
    const target = toCompressionTarget(500, "KB");

    // WebPのアニメーション・寸法安全性チェックは非同期のため、事前にeligibilityForを
    // 呼んで開始させ、readyになるまで待つ(use-image-compression.test.tsと同じ手順)。
    act(() => {
      result.current.eligibilityFor(itemC);
    });
    await waitFor(() => expect(result.current.eligibilityFor(itemC).kind).toBe("ready"));

    act(() => result.current.startCompression(itemA, target));
    act(() => result.current.startCompression(itemB, target));
    act(() => result.current.startCompression(itemC, target));

    await waitFor(() => expect(jpeg.enqueuedIds).toEqual(["a"]));
    expect(png.enqueuedIds).toHaveLength(0);

    act(() => {
      jpeg.resolve("a", doneJpegOutcome());
    });
    await waitFor(() => expect(png.enqueuedIds).toEqual(["b"]));
    expect(jpeg.enqueuedIds).toEqual(["a"]); // Cはまだ

    act(() => {
      png.resolve("b", donePngOutcome());
    });
    await waitFor(() => expect(jpeg.enqueuedIds).toEqual(["a", "c"]));
  });
});
