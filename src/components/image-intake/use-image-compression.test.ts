import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCompressionTarget } from "./compression-target";
import type {
  CompressionClient,
  CompressOutcome,
  CompressProgress,
} from "./image-compression-client";
import { createCompressionClient } from "./image-compression-client";
import { eligibilityFor, useImageCompression } from "./use-image-compression";
import { ja } from "../../i18n/dictionaries/ja";
import type { IntakeItem } from "./types";

vi.mock("./image-compression-client", () => ({
  createCompressionClient: vi.fn(),
}));

interface ControllableClient {
  client: CompressionClient;
  enqueuedIds: string[];
  start(id: string): void;
  progress(id: string, progress: CompressProgress): void;
  resolve(id: string, outcome: CompressOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
  destroyMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  const resolvers = new Map<string, (outcome: CompressOutcome) => void>();
  const starters = new Map<string, () => void>();
  const progressors = new Map<string, (progress: CompressProgress) => void>();
  const enqueuedIds: string[] = [];

  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const destroyMock = vi.fn();

  const client: CompressionClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      if (callbacks?.onStart) starters.set(task.id, callbacks.onStart);
      if (callbacks?.onProgress) progressors.set(task.id, callbacks.onProgress);
      return new Promise<CompressOutcome>((resolve) => {
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
    progress(id, progress) {
      progressors.get(id)?.(progress);
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

function makeJpegItem(
  overrides: {
    id?: string;
    fileName?: string;
    fileSize?: number;
    width?: number;
    height?: number;
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.jpg";
  const file = new File([new Uint8Array(overrides.fileSize ?? 800_000)], fileName, {
    type: "image/jpeg",
  });
  return {
    id: overrides.id ?? "item-1",
    file,
    objectUrl: "blob:mock-original",
    extension: "jpg",
    detectedFormat: "jpeg",
    mimeType: "image/jpeg",
    extensionMismatch: false,
    status: {
      kind: "ready",
      dimensions: { width: overrides.width ?? 2000, height: overrides.height ?? 1000 },
    },
  };
}

function makeHeicDoneItem(
  overrides: {
    id?: string;
    fileName?: string;
    blobSize?: number;
    width?: number;
    height?: number;
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.heic";
  const file = new File([new Uint8Array([1, 2, 3])], fileName, { type: "image/heic" });
  const blob = new Blob([new Uint8Array(overrides.blobSize ?? 800_000)], { type: "image/jpeg" });
  return {
    id: overrides.id ?? "item-1",
    file,
    objectUrl: "blob:mock-original",
    extension: "heic",
    detectedFormat: "heic",
    mimeType: "image/heic",
    extensionMismatch: false,
    status: {
      kind: "heic-done",
      result: {
        objectUrl: "blob:mock-converted",
        blob,
        jpegBytes: blob.size,
        width: overrides.width ?? 2000,
        height: overrides.height ?? 1000,
      },
    },
  };
}

function makeFormatItem(format: "png" | "webp", id = "item-1"): IntakeItem {
  const file = new File([new Uint8Array(8)], `photo.${format}`, { type: `image/${format}` });
  return {
    id,
    file,
    objectUrl: "blob:mock-original",
    extension: format,
    detectedFormat: format,
    mimeType: `image/${format}`,
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
function riffHeader(payloadLength: number): number[] {
  return [...ascii("RIFF"), ...u32le(4 + payloadLength), ...ascii("WEBP")];
}
function vp8xChunk(width: number, height: number, animationFlag: boolean): number[] {
  const flags = animationFlag ? 0x02 : 0x00;
  const payload = [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  return [...ascii("VP8X"), ...u32le(payload.length), ...payload];
}
/**
 * ファイルサイズを底上げするための埋め草チャンク。ANIM/ANMF/VP8Xいずれとも異なるfourCCを使い、
 * chunkSizeにpaddingLength全体を正しく宣言することで、実際のWebPの大きなピクセルデータ相当の
 * チャンクを模す(単純にゼロバイトを末尾へ付け足すと、パーサーがそれを大量のサイズ0チャンクの
 * 連続と解釈しMAX_CHUNKS_TO_SCANで打ち切られてしまうため、必ず正しいチャンク構造にする)。
 */
function paddingChunk(paddingLength: number): number[] {
  if (paddingLength <= 0) return [];
  return [...ascii("JUNK"), ...u32le(paddingLength), ...new Array(paddingLength).fill(0)];
}

function buildWebpBytes(
  options: { width?: number; height?: number; animated?: boolean; totalSize?: number } = {},
) {
  const vp8x = vp8xChunk(options.width ?? 500, options.height ?? 500, options.animated ?? false);
  const baseLength = 12 + vp8x.length;
  const padding = paddingChunk(Math.max(0, (options.totalSize ?? 0) - baseLength - 8));
  const chunk = [...vp8x, ...padding];
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

/**
 * 実際に読み取り可能なRIFF/VP8Xバイト列を持つWebPアイテムを作る。
 * use-image-compression.tsの非同期チェック(file.arrayBuffer→アニメーション・寸法安全性判定)を
 * 実際に通過させるため、file-signature.test.ts等と同様の手組みWebPバイト列を使う。
 */
function makeWebpItem(
  overrides: {
    id?: string;
    fileName?: string;
    fileSize?: number;
    width?: number;
    height?: number;
    animated?: boolean;
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.webp";
  const bytes = buildWebpBytes({
    width: overrides.width ?? 500,
    height: overrides.height ?? 500,
    animated: overrides.animated ?? false,
    totalSize: overrides.fileSize,
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

function makeNotReadyItem(id = "item-1"): IntakeItem {
  const file = new File([new Uint8Array(8)], "photo.jpg", { type: "image/jpeg" });
  return {
    id,
    file,
    objectUrl: "blob:mock-original",
    extension: "jpg",
    detectedFormat: null,
    mimeType: "image/jpeg",
    extensionMismatch: false,
    status: { kind: "analyzing" },
  };
}

describe("eligibilityFor", () => {
  it("非対応ブラウザでは常にunsupported-browserを返す", () => {
    expect(eligibilityFor(makeJpegItem(), false)).toEqual({ kind: "unsupported-browser" });
  });

  it("JPEGのreadyアイテムはready(kind: jpeg)を返す", () => {
    const result = eligibilityFor(makeJpegItem(), true);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.source.kind).toBe("jpeg");
    }
  });

  it("heic-doneアイテムはready(kind: heic-derived-jpeg)を返す", () => {
    const result = eligibilityFor(makeHeicDoneItem(), true);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.source.kind).toBe("heic-derived-jpeg");
    }
  });

  it("PNGはunsupported-formatを返す", () => {
    /**
     * allowedFormats(CompressWorkbench)によりPNGはintake時点でunsupported-formatとして
     * 拒否されるため、"ready"ではなくintake拒否後の状態を再現する。
     */
    const item = { ...makeFormatItem("png"), status: { kind: "unsupported-format" as const } };
    expect(eligibilityFor(item, true)).toEqual({ kind: "unsupported-format" });
  });

  it("WebPはwebpCheck省略時は常にnot-ready(非同期チェック待ち)を返す", () => {
    expect(eligibilityFor(makeFormatItem("webp"), true)).toEqual({ kind: "not-ready" });
  });

  it("WebPはwebpCheck='ready'でready(kind: webp)を返す", () => {
    const result = eligibilityFor(makeFormatItem("webp"), true, "ready");
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.source.kind).toBe("webp");
    }
  });

  it("WebPはwebpCheck='unsupported-animation'でunsupported-animationを返す", () => {
    expect(eligibilityFor(makeFormatItem("webp"), true, "unsupported-animation")).toEqual({
      kind: "unsupported-animation",
    });
  });

  it("WebPはwebpCheck='unsafe-dimensions'でunsafe-dimensionsを返す", () => {
    expect(eligibilityFor(makeFormatItem("webp"), true, "unsafe-dimensions")).toEqual({
      kind: "unsafe-dimensions",
    });
  });

  it("JPEGの寸法が安全上限を超える場合はunsafe-dimensionsを返す", () => {
    const item = makeJpegItem({ width: 20000, height: 20000 });
    expect(eligibilityFor(item, true)).toEqual({ kind: "unsafe-dimensions" });
  });

  it("HEIC変換後JPEGの寸法が安全上限を超える場合はunsafe-dimensionsを返す", () => {
    const item = makeHeicDoneItem({ width: 20000, height: 20000 });
    expect(eligibilityFor(item, true)).toEqual({ kind: "unsafe-dimensions" });
  });

  it("解析中等はnot-readyを返す", () => {
    expect(eligibilityFor(makeNotReadyItem(), true)).toEqual({ kind: "not-ready" });
  });
});

describe("useImageCompression", () => {
  let controllable: ControllableClient;

  beforeEach(() => {
    controllable = createControllableClient();
    vi.mocked(createCompressionClient).mockReturnValue(controllable.client);
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

  it("元JPEGが既に目標容量以下の場合、再エンコードせず即座に成功する", () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeJpegItem({ fileSize: 100_000 });

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });

    const job = result.current.jobs[item.id];
    expect(job.status.kind).toBe("done");
    if (job.status.kind === "done") {
      expect(job.status.result.unchanged).toBe(true);
      expect(job.status.result.encodeCount).toBe(0);
      expect(job.status.result.outputWidth).toBe(2000);
      expect(job.status.result.outputHeight).toBe(1000);
    }
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("目標超過時はqueued→processing→doneと遷移し、出力ファイル名が生成される", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeJpegItem({ fileName: "IMG_1201.jpg", fileSize: 900_000 });
    const target = toCompressionTarget(500, "KB");

    act(() => {
      result.current.startCompression(item, target);
    });

    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.start(item.id);
    });
    expect(result.current.jobs[item.id].status.kind).toBe("processing");

    act(() => {
      controllable.progress(item.id, { phase: "quality", attempt: 3, maxAttempts: 12 });
    });
    const processingStatus = result.current.jobs[item.id].status;
    expect(processingStatus).toMatchObject({
      kind: "processing",
      progress: { phase: "quality", attempt: 3, maxAttempts: 12 },
    });

    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 1500,
        height: 750,
        quality: 0.6,
        encodeCount: 5,
        resizeCount: 1,
        elapsedMs: 1200,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.outputFileName).toBe("IMG_1201-500kb.jpg");
      expect(job.status.result.outputWidth).toBe(1500);
      expect(job.status.result.encodeCount).toBe(5);
      expect(job.status.result.resizeCount).toBe(1);
      expect(job.status.result.unchanged).toBe(false);
    }
  });

  it("達成不能な場合はerror(target-unreachable)になる", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeJpegItem({ fileSize: 900_000 });

    act(() => {
      result.current.startCompression(item, toCompressionTarget(1, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, {
        status: "unreachable",
        encodeCount: 12,
        resizeCount: 3,
        elapsedMs: 20000,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    const status = result.current.jobs[item.id].status;
    expect(status).toMatchObject({ kind: "error", reason: "target-unreachable" });
  });

  it("Workerからのエラーはerror(encode-failed)になる", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeJpegItem({ fileSize: 900_000 });

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, { status: "error", message: "encode failed" });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    const status = result.current.jobs[item.id].status;
    expect(status).toMatchObject({
      kind: "error",
      reason: "encode-failed",
      message: "encode failed",
    });
  });

  it("1件が達成不能でも、別アイテムの処理には影響しない", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const itemA = makeJpegItem({ id: "a", fileSize: 900_000 });
    const itemB = makeJpegItem({ id: "b", fileSize: 900_000 });

    act(() => {
      result.current.startCompression(itemA, toCompressionTarget(1, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toContain("a"));
    act(() => {
      controllable.resolve("a", {
        status: "unreachable",
        encodeCount: 12,
        resizeCount: 3,
        elapsedMs: 1,
      });
    });

    act(() => {
      result.current.startCompression(itemB, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toContain("b"));
    act(() => {
      controllable.resolve("b", {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 100,
        height: 100,
        quality: 0.8,
        encodeCount: 1,
        resizeCount: 0,
        elapsedMs: 10,
      });
    });

    await waitFor(() => {
      expect(result.current.jobs.a.status.kind).toBe("error");
      expect(result.current.jobs.b.status.kind).toBe("done");
    });
  });

  it("待機中のキャンセルはcancelledになる", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeJpegItem({ fileSize: 900_000 });
    controllable.cancelMock.mockReturnValue(true);

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      result.current.cancelCompression(item.id);
    });

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id].status.kind).toBe("cancelled");
  });

  it("cancelがfalseを返した場合(既に完了済み等)はジョブ状態を変更しない", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeJpegItem({ fileSize: 900_000 });
    controllable.cancelMock.mockReturnValue(false);

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 100,
        height: 100,
        quality: 0.8,
        encodeCount: 1,
        resizeCount: 0,
        elapsedMs: 10,
      });
    });
    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));

    act(() => {
      result.current.cancelCompression(item.id);
    });

    expect(result.current.jobs[item.id].status.kind).toBe("done");
  });

  it("removeJobはWorkerのcancelとObject URLの解放を行い、ジョブを削除する", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeJpegItem({ fileSize: 100_000 });

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    expect(result.current.jobs[item.id]).toBeDefined();

    const revokeSpy = vi.mocked(URL.revokeObjectURL);
    revokeSpy.mockClear();

    act(() => {
      result.current.removeJob(item.id);
    });

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(result.current.jobs[item.id]).toBeUndefined();
  });

  it("clearJobsはcancelAllとrevokeAllを行い、全ジョブを消去する", () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const itemA = makeJpegItem({ id: "a", fileSize: 100_000 });
    const itemB = makeJpegItem({ id: "b", fileSize: 100_000 });

    act(() => {
      result.current.startCompression(itemA, toCompressionTarget(500, "KB"));
      result.current.startCompression(itemB, toCompressionTarget(500, "KB"));
    });

    act(() => {
      result.current.clearJobs();
    });

    expect(controllable.cancelAllMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs).toEqual({});
  });

  it("WebP: 元Blobが既に目標容量以下の場合、再エンコードせず即座に成功しoutputFormat/ファイル名がWebP用になる", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeWebpItem({ fileSize: 100 });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => {
      expect(result.current.eligibilityFor(item).kind).toBe("ready");
    });

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });

    const job = result.current.jobs[item.id];
    expect(job.status.kind).toBe("done");
    if (job.status.kind === "done") {
      expect(job.status.result.unchanged).toBe(true);
      expect(job.status.result.outputFormat).toBe("webp");
      expect(job.status.result.outputFileName).toBe("photo-compressed.webp");
    }
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("WebP: 目標超過時はformat:webpでenqueueされ、webp-doneの結果がoutputFormat:webpとして反映される", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeWebpItem({ fileName: "photo.webp", fileSize: 900_000 });
    const target = toCompressionTarget(500, "KB");

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => {
      expect(result.current.eligibilityFor(item).kind).toBe("ready");
    });

    act(() => {
      result.current.startCompression(item, target);
    });

    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(controllable.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ format: "webp" }),
      expect.anything(),
    );

    act(() => {
      controllable.resolve(item.id, {
        status: "webp-done",
        webpBuffer: new ArrayBuffer(4),
        width: 400,
        height: 400,
        quality: 0.7,
        encodeCount: 3,
        resizeCount: 0,
        elapsedMs: 300,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.outputFileName).toBe("photo-compressed.webp");
      expect(job.status.result.outputFormat).toBe("webp");
      expect(job.status.result.blob.type).toBe("image/webp");
      expect(job.status.result.unchanged).toBe(false);
    }
  });

  it("WebP: Workerがunsafe-dimensionsを返した場合、固定文言のerror(reason: unsafe-dimensions)になる", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeWebpItem({ fileSize: 900_000 });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, { status: "unsafe-dimensions" });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsafe-dimensions",
      message: "画像のサイズが大きすぎるため、安全に処理できませんでした。",
    });
  });

  it("WebP: Workerがunsupported-webp-encoderを返した場合、固定文言のerrorになる(PNG/JPEGへ暗黙変換しない)", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeWebpItem({ fileSize: 900_000 });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, { status: "unsupported-webp-encoder" });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsupported-webp-encoder",
      message: "このブラウザではWebP画像を圧縮できません。",
    });
  });

  it("WebP: Workerがunsupported-animationを返した場合(フック側判定を迂回した想定)、固定文言のerrorになる", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeWebpItem({ fileSize: 900_000 });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, { status: "unsupported-animation" });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsupported-animation",
      message: "アニメーションWebPには現在対応していません。",
    });
  });

  it("WebP: Workerがmalformed-webpを返した場合、decode-failedの固定文言のerrorになる", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeWebpItem({ fileSize: 900_000 });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, { status: "malformed-webp" });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "decode-failed",
      message: "画像を読み込めませんでした。別のファイルでお試しください。",
    });
  });

  it("Workerがdimension-mismatchを返した場合、decode-failedの固定文言のerrorになる", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeJpegItem({ fileSize: 900_000 });

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, { status: "dimension-mismatch" });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "decode-failed",
      message: "画像を読み込めませんでした。別のファイルでお試しください。",
    });
  });

  it("WebP: アニメーションWebPはeligibilityForがunsupported-animationになりstartCompressionは何もしない", async () => {
    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    const item = makeWebpItem({ animated: true, fileSize: 900_000 });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => {
      expect(result.current.eligibilityFor(item)).toEqual({ kind: "unsupported-animation" });
    });

    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });

    expect(result.current.jobs[item.id]).toBeUndefined();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("アンマウント時にdestroyが呼ばれる", () => {
    const { unmount } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    unmount();
    expect(controllable.destroyMock).toHaveBeenCalledTimes(1);
  });

  it("Worker等が非対応の環境ではisSupportedがfalseになり、startCompressionは何もしない", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("Worker", undefined);

    const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
    expect(result.current.isSupported).toBe(false);

    const item = makeJpegItem({ fileSize: 100_000 });
    act(() => {
      result.current.startCompression(item, toCompressionTarget(500, "KB"));
    });

    expect(result.current.jobs[item.id]).toBeUndefined();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  describe("request generation(arrayBuffer読み込み中の競合対策)", () => {
    /**
     * item.file.arrayBuffer()の解決タイミングをテストコードから制御する。
     * 実装(useImageCompression)はsource.blob.arrayBuffer()を呼ぶため、
     * source.blob === item.fileとなるJPEGアイテム(makeJpegItem)で使う。
     */
    function withControllableArrayBuffer(file: File) {
      let resolveFn: (buffer: ArrayBuffer) => void = () => {};
      let rejectFn: (error: unknown) => void = () => {};
      let callCount = 0;
      vi.spyOn(file, "arrayBuffer").mockImplementation(() => {
        callCount += 1;
        return new Promise<ArrayBuffer>((resolve, reject) => {
          resolveFn = resolve;
          rejectFn = reject;
        });
      });
      return {
        resolve: (buffer: ArrayBuffer = new ArrayBuffer(4)) => resolveFn(buffer),
        reject: (error: unknown) => rejectFn(error),
        callCount: () => callCount,
      };
    }

    it("arrayBuffer待機中にcancelすると即座にcancelled状態になり、解決後もenqueueされない", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });
      const buffer = withControllableArrayBuffer(item.file);

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      expect(result.current.jobs[item.id].status.kind).toBe("queued");

      act(() => {
        result.current.cancelCompression(item.id);
      });
      expect(result.current.jobs[item.id].status.kind).toBe("cancelled");

      act(() => {
        buffer.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(controllable.client.enqueue).not.toHaveBeenCalled();
      expect(result.current.jobs[item.id].status.kind).toBe("cancelled");
    });

    it("arrayBuffer待機中にremoveJobすると、解決後もenqueueされずjobが復活しない", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });
      const buffer = withControllableArrayBuffer(item.file);

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      act(() => {
        result.current.removeJob(item.id);
      });
      expect(result.current.jobs[item.id]).toBeUndefined();

      act(() => {
        buffer.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(controllable.client.enqueue).not.toHaveBeenCalled();
      expect(result.current.jobs[item.id]).toBeUndefined();
    });

    it("arrayBuffer待機中にclearJobsすると、解決後もenqueueされない", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });
      const buffer = withControllableArrayBuffer(item.file);

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      act(() => {
        result.current.clearJobs();
      });
      expect(result.current.jobs).toEqual({});

      act(() => {
        buffer.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(controllable.client.enqueue).not.toHaveBeenCalled();
      expect(result.current.jobs).toEqual({});
    });

    it("arrayBuffer待機中にアンマウントすると、解決後もenqueue/state更新/Object URL作成が起きない", async () => {
      const { result, unmount } = renderHook(() =>
        useImageCompression(ja.ui.compressionPanel.errors),
      );
      const item = makeJpegItem({ fileSize: 900_000 });
      const buffer = withControllableArrayBuffer(item.file);

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });

      const createSpy = vi.mocked(URL.createObjectURL);
      const createCallsBeforeUnmount = createSpy.mock.calls.length;
      unmount();

      act(() => {
        buffer.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(controllable.client.enqueue).not.toHaveBeenCalled();
      expect(createSpy.mock.calls.length).toBe(createCallsBeforeUnmount);
    });

    it("同一itemの再処理: 古いarrayBufferが後から解決してもenqueueされず、新しいtargetのみenqueueされる", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });
      const firstBuffer = withControllableArrayBuffer(item.file);

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });

      // 1回目の読み込みが終わる前に、同じアイテムへ別targetで再度startCompressionする
      const secondBuffer = withControllableArrayBuffer(item.file);
      act(() => {
        result.current.startCompression(item, toCompressionTarget(200, "KB"));
      });

      // 1回目(古い)のarrayBufferが後から解決しても、enqueueされない
      act(() => {
        firstBuffer.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(controllable.client.enqueue).not.toHaveBeenCalled();

      // 2回目(新しい)のarrayBufferが解決すると、新しいtargetでenqueueされる
      act(() => {
        secondBuffer.resolve();
      });
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
      expect(controllable.client.enqueue).toHaveBeenCalledTimes(1);
      expect(controllable.client.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ targetBytes: 200_000 }),
        expect.anything(),
      );
    });

    it("2ファイルのarrayBufferを逆順に解決しても、enqueue順はstartCompressionの呼び出し順になる", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const itemA = makeJpegItem({ id: "a", fileSize: 900_000 });
      const itemB = makeJpegItem({ id: "b", fileSize: 900_000 });
      const bufferA = withControllableArrayBuffer(itemA.file);
      const bufferB = withControllableArrayBuffer(itemB.file);

      act(() => {
        result.current.startCompression(itemA, toCompressionTarget(500, "KB"));
        result.current.startCompression(itemB, toCompressionTarget(500, "KB"));
      });

      // Bを先に解決してもAが先にenqueueされる(呼び出し順を維持する)
      act(() => {
        bufferB.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(controllable.enqueuedIds).toEqual([]);

      act(() => {
        bufferA.resolve();
      });
      await waitFor(() => expect(controllable.enqueuedIds).toEqual(["a", "b"]));
    });

    it("arrayBuffer自体が失敗した場合はerror状態になり、unhandled rejectionにならず、次の要求は継続する", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const itemA = makeJpegItem({ id: "a", fileSize: 900_000 });
      const itemB = makeJpegItem({ id: "b", fileSize: 900_000 });
      const bufferA = withControllableArrayBuffer(itemA.file);

      act(() => {
        result.current.startCompression(itemA, toCompressionTarget(500, "KB"));
      });
      act(() => {
        bufferA.reject(new Error("read failed"));
      });

      await waitFor(() => expect(result.current.jobs[itemA.id].status.kind).toBe("error"));
      expect(result.current.jobs[itemA.id].status).toMatchObject({
        kind: "error",
        reason: "encode-failed",
        message: "画像処理を開始できませんでした。もう一度お試しください。",
      });
      expect(controllable.client.enqueue).not.toHaveBeenCalled();

      // 後続の要求(別アイテム)は影響を受けず継続する
      act(() => {
        result.current.startCompression(itemB, toCompressionTarget(500, "KB"));
      });
      await waitFor(() => expect(controllable.enqueuedIds).toEqual(["b"]));
    });

    it("staleなonStartは無視される(削除後にWorkerが処理を開始してもprocessingへ遷移しない)", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

      act(() => {
        result.current.removeJob(item.id);
      });
      expect(result.current.jobs[item.id]).toBeUndefined();

      act(() => {
        controllable.start(item.id);
      });
      expect(result.current.jobs[item.id]).toBeUndefined();
    });

    it("staleなonProgressは無視される", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
      act(() => {
        controllable.start(item.id);
      });
      expect(result.current.jobs[item.id].status.kind).toBe("processing");

      act(() => {
        result.current.removeJob(item.id);
      });

      act(() => {
        controllable.progress(item.id, { phase: "resize", attempt: 2, maxAttempts: 12 });
      });
      expect(result.current.jobs[item.id]).toBeUndefined();
    });

    it("staleなdone outcomeは無視され、Object URLも作られない", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

      act(() => {
        result.current.removeJob(item.id);
      });

      const createSpy = vi.mocked(URL.createObjectURL);
      const createCallsBeforeResolve = createSpy.mock.calls.length;

      act(() => {
        controllable.resolve(item.id, {
          status: "done",
          jpegBuffer: new ArrayBuffer(4),
          width: 100,
          height: 100,
          quality: 0.8,
          encodeCount: 1,
          resizeCount: 0,
          elapsedMs: 10,
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result.current.jobs[item.id]).toBeUndefined();
      expect(createSpy.mock.calls.length).toBe(createCallsBeforeResolve);
    });

    it("staleなerror outcomeも無視される", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

      act(() => {
        result.current.removeJob(item.id);
      });

      act(() => {
        controllable.resolve(item.id, { status: "error", message: "old error" });
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result.current.jobs[item.id]).toBeUndefined();
    });

    it("再圧縮時、直前の結果のObject URLは解放される(二重確保しない)", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 100_000 });

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      expect(result.current.jobs[item.id].status.kind).toBe("done");

      const revokeSpy = vi.mocked(URL.revokeObjectURL);
      revokeSpy.mockClear();

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });

      expect(revokeSpy).toHaveBeenCalled();
    });

    it("Workerからのoutcomeが二重に届いても2回目は無視される(二重resolve防止)", async () => {
      const { result } = renderHook(() => useImageCompression(ja.ui.compressionPanel.errors));
      const item = makeJpegItem({ fileSize: 900_000 });

      act(() => {
        result.current.startCompression(item, toCompressionTarget(500, "KB"));
      });
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

      const doneOutcome: CompressOutcome = {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 100,
        height: 100,
        quality: 0.8,
        encodeCount: 1,
        resizeCount: 0,
        elapsedMs: 10,
      };

      act(() => {
        controllable.resolve(item.id, doneOutcome);
      });
      await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
      const firstUrl =
        result.current.jobs[item.id].status.kind === "done"
          ? (result.current.jobs[item.id].status as { result: { objectUrl: string } }).result
              .objectUrl
          : null;

      // 同じPromiseを2回resolveしてもJS的には2回目は無視されるが、念のためjobが
      // 壊れないこと(直前の結果のままであること)を確認する
      expect(() => {
        controllable.resolve(item.id, doneOutcome);
      }).not.toThrow();
      const status = result.current.jobs[item.id].status;
      expect(status.kind).toBe("done");
      if (status.kind === "done") {
        expect(status.result.objectUrl).toBe(firstUrl);
      }
    });
  });
});
