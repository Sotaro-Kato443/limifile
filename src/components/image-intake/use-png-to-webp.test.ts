import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPngToWebpClient } from "./png-to-webp-client";
import { eligibilityFor, usePngToWebp } from "./use-png-to-webp";
import { ja } from "../../i18n/dictionaries/ja";
import type { PngToWebpClient, PngToWebpOutcome } from "./png-to-webp-client";
import type { IntakeItem } from "./types";

vi.mock("./png-to-webp-client", () => ({
  createPngToWebpClient: vi.fn(),
}));

interface ControllableClient {
  client: PngToWebpClient;
  enqueuedIds: string[];
  start(id: string): void;
  resolve(id: string, outcome: PngToWebpOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
  destroyMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  const resolvers = new Map<string, (outcome: PngToWebpOutcome) => void>();
  const starters = new Map<string, () => void>();
  const enqueuedIds: string[] = [];

  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const destroyMock = vi.fn();

  const client: PngToWebpClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      if (callbacks?.onStart) starters.set(task.id, callbacks.onStart);
      return new Promise<PngToWebpOutcome>((resolve) => {
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
    expect(eligibilityFor(makePngItem(), false)).toEqual({ kind: "unsupported-browser" });
  });

  it("PNGはpngCheck省略時は常にnot-ready(非同期チェック待ち)を返す", () => {
    expect(eligibilityFor(makePngItem(), true)).toEqual({ kind: "not-ready" });
  });

  it("PNGはpngCheck='ready'でready(source有り)を返す", () => {
    const result = eligibilityFor(makePngItem(), true, "ready");
    expect(result.kind).toBe("ready");
  });

  it("PNGはpngCheck='unsupported-animation'でunsupported-animationを返す", () => {
    expect(eligibilityFor(makePngItem(), true, "unsupported-animation")).toEqual({
      kind: "unsupported-animation",
    });
  });

  it("PNGはpngCheck='unsafe-dimensions'でunsafe-dimensionsを返す", () => {
    expect(eligibilityFor(makePngItem(), true, "unsafe-dimensions")).toEqual({
      kind: "unsafe-dimensions",
    });
  });

  it("JPEGはunsupported-formatを返す", () => {
    /**
     * allowedFormats(PngToWebpWorkbench: ["png"])によりJPEGはintake時点で
     * unsupported-formatとして拒否されるため、"ready"ではなくintake拒否後の状態を再現する。
     */
    const item = { ...makeJpegItem(), status: { kind: "unsupported-format" as const } };
    expect(eligibilityFor(item, true)).toEqual({ kind: "unsupported-format" });
  });

  it("HEICパイプライン中(変換待ち等)もunsupported-formatを返す", () => {
    expect(eligibilityFor(makeHeicPendingItem(), true)).toEqual({ kind: "unsupported-format" });
  });

  it("解析中等はnot-readyを返す", () => {
    expect(eligibilityFor(makeNotReadyItem(), true)).toEqual({ kind: "not-ready" });
  });
});

describe("usePngToWebp", () => {
  let controllable: ControllableClient;

  beforeEach(() => {
    controllable = createControllableClient();
    vi.mocked(createPngToWebpClient).mockReturnValue(controllable.client);
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

  it("通常PNG: 非同期チェック後にreadyになり、変換フローが動作する(quality preset反映)", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem({ fileName: "photo.png" });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => {
      result.current.startConversion(item, "light");
    });

    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(controllable.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 0.65 }),
      expect.anything(),
    );

    act(() => controllable.start(item.id));
    expect(result.current.jobs[item.id].status.kind).toBe("processing");

    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        webpBuffer: new ArrayBuffer(4),
        width: 500,
        height: 500,
        quality: 0.65,
        elapsedMs: 42,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.outputFileName).toBe("photo.webp");
      expect(job.status.result.qualityPreset).toBe("light");
      expect(job.status.result.blob.type).toBe("image/webp");
    }
  });

  it("デフォルトのquality preset(standard=0.80)で変換できる", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => result.current.startConversion(item, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(controllable.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 0.8 }),
      expect.anything(),
    );
  });

  it("高画質(high=0.90)で変換できる", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));

    act(() => result.current.startConversion(item, "high"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(controllable.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 0.9 }),
      expect.anything(),
    );
  });

  it("アニメーションPNGはeligibilityForがunsupported-animationになりstartConversionは何もしない", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem({ animated: true });

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => {
      expect(result.current.eligibilityFor(item)).toEqual({ kind: "unsupported-animation" });
    });

    act(() => result.current.startConversion(item, "standard"));
    expect(result.current.jobs[item.id]).toBeUndefined();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("Workerがunsupported-animationを返した場合(フック側判定を迂回した想定)、固定文言のerrorになる", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "unsupported-animation" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsupported-animation",
      message: "アニメーションPNGには現在対応していません。",
    });
  });

  it("Workerがmalformed-pngを返した場合、decode-failedの固定文言のerrorになる", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "malformed-png" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "decode-failed",
      message: "画像を読み込めませんでした。別のファイルでお試しください。",
    });
  });

  it("Workerがunsafe-dimensionsを返した場合、固定文言のerrorになる", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "unsafe-dimensions" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsafe-dimensions",
      message: "画像のサイズが大きすぎるため、安全に処理できませんでした。",
    });
  });

  it("Workerがdimension-mismatchを返した場合、decode-failedの固定文言のerrorになる", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "dimension-mismatch" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "decode-failed",
    });
  });

  it("Workerがunsupported-webp-encoderを返した場合、固定文言のerrorになる(PNGへ暗黙変換しない)", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "unsupported-webp-encoder" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsupported-webp-encoder",
      message: "このブラウザではWebP画像へ変換できません。",
    });
  });

  it("Workerがtimeoutを返した場合、固定文言のerrorになる", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => controllable.resolve(item.id, { status: "timeout" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "timeout",
    });
  });

  it("Workerがerrorを返した場合、固定文言(encode-failed)のerrorになる(内部メッセージを画面に出さない)", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
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
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
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

    act(() => result.current.startConversion(itemA, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toContain("a"));
    act(() => controllable.resolve("a", { status: "malformed-png" }));

    act(() => result.current.startConversion(itemB, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toContain("b"));
    act(() =>
      controllable.resolve("b", {
        status: "done",
        webpBuffer: new ArrayBuffer(4),
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
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();
    controllable.cancelMock.mockReturnValue(true);

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => result.current.cancelConversion(item.id));

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id].status.kind).toBe("cancelled");
  });

  it("removeJobはWorkerのcancelとObject URLの解放を行い、ジョブを削除する", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    const item = makePngItem();

    act(() => {
      result.current.eligibilityFor(item);
    });
    await waitFor(() => expect(result.current.eligibilityFor(item).kind).toBe("ready"));
    act(() => result.current.startConversion(item, "standard"));
    expect(result.current.jobs[item.id]).toBeDefined();

    act(() => result.current.removeJob(item.id));

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id]).toBeUndefined();
  });

  it("clearJobsはcancelAllとrevokeAllを行い、全ジョブを消去する", async () => {
    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
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
      result.current.startConversion(itemA, "standard");
      result.current.startConversion(itemB, "standard");
    });

    act(() => result.current.clearJobs());

    expect(controllable.cancelAllMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs).toEqual({});
  });

  it("アンマウント時にdestroyが呼ばれる", () => {
    const { unmount } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    unmount();
    expect(controllable.destroyMock).toHaveBeenCalledTimes(1);
  });

  it("Worker等が非対応の環境ではisSupportedがfalseになり、startConversionは何もしない", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("Worker", undefined);

    const { result } = renderHook(() => usePngToWebp(ja.ui.pngToWebp.panel.errors));
    expect(result.current.isSupported).toBe(false);

    const item = makePngItem();
    act(() => result.current.startConversion(item, "standard"));

    expect(result.current.jobs[item.id]).toBeUndefined();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });
});
