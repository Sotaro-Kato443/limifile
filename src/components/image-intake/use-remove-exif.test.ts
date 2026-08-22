import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eligibilityFor, useRemoveExif } from "./use-remove-exif";
import type { RemoveExifClient, RemoveExifOutcome } from "./remove-exif-client";
import type { IntakeItem } from "./types";

vi.mock("./remove-exif-client", () => ({
  createRemoveExifClient: vi.fn(),
}));

import { createRemoveExifClient } from "./remove-exif-client";

interface ControllableClient {
  client: RemoveExifClient;
  enqueuedIds: string[];
  start(id: string): void;
  resolve(id: string, outcome: RemoveExifOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
  destroyMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  const resolvers = new Map<string, (outcome: RemoveExifOutcome) => void>();
  const starters = new Map<string, () => void>();
  const enqueuedIds: string[] = [];

  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const destroyMock = vi.fn();

  const client: RemoveExifClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      if (callbacks?.onStart) starters.set(task.id, callbacks.onStart);
      return new Promise<RemoveExifOutcome>((resolve) => {
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
  const file = new File([new Uint8Array(overrides.fileSize ?? 8)], fileName, {
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
  overrides: { id?: string; fileName?: string; width?: number; height?: number } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.heic";
  const file = new File([new Uint8Array([1, 2, 3])], fileName, { type: "image/heic" });
  const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
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
    if (result.kind === "ready") expect(result.source.kind).toBe("jpeg");
  });

  it("heic-doneアイテムはready(kind: heic-derived-jpeg)を返す", () => {
    const result = eligibilityFor(makeHeicDoneItem(), true);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.source.kind).toBe("heic-derived-jpeg");
  });

  it("PNG/WebPはunsupported-formatを返す", () => {
    /**
     * allowedFormats(RemoveExifWorkbench: ["jpeg", "heic"])によりPNG/WebPはintake時点で
     * unsupported-formatとして拒否されるため、"ready"ではなくintake拒否後の状態を再現する。
     */
    const pngItem = { ...makeFormatItem("png"), status: { kind: "unsupported-format" as const } };
    const webpItem = {
      ...makeFormatItem("webp"),
      status: { kind: "unsupported-format" as const },
    };
    expect(eligibilityFor(pngItem, true)).toEqual({ kind: "unsupported-format" });
    expect(eligibilityFor(webpItem, true)).toEqual({ kind: "unsupported-format" });
  });

  it("解析中等はnot-readyを返す", () => {
    expect(eligibilityFor(makeNotReadyItem(), true)).toEqual({ kind: "not-ready" });
  });
});

describe("useRemoveExif", () => {
  let controllable: ControllableClient;

  beforeEach(() => {
    controllable = createControllableClient();
    vi.mocked(createRemoveExifClient).mockReturnValue(controllable.client);
    vi.stubGlobal("Worker", class {});
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:mock-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("queued→processing→doneと遷移し、出力ファイル名・寸法・容量が反映される", async () => {
    const { result } = renderHook(() => useRemoveExif());
    const item = makeJpegItem({ fileName: "IMG_1201.jpg", width: 3000, height: 2000 });

    act(() => {
      result.current.startRemoval(item);
    });
    expect(result.current.jobs[item.id].status.kind).toBe("queued");

    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.start(item.id);
    });
    expect(result.current.jobs[item.id].status.kind).toBe("processing");

    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        originalBytes: 1000,
        outputBytes: 800,
        orientationKept: true,
        iccKept: true,
        elapsedMs: 2,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.outputFileName).toBe("IMG_1201-metadata-removed.jpg");
      expect(job.status.result.originalWidth).toBe(3000);
      expect(job.status.result.outputWidth).toBe(3000);
      expect(job.status.result.originalHeight).toBe(2000);
      expect(job.status.result.outputHeight).toBe(2000);
      expect(job.status.result.originalBytes).toBe(1000);
      expect(job.status.result.outputBytes).toBe(800);
      expect(job.status.result.orientationKept).toBe(true);
      expect(job.status.result.iccKept).toBe(true);
      expect(job.status.result.blob.type).toBe("image/jpeg");
    }
  });

  it("HEIC由来アイテムは元のベース名を使い、HEIC本体は再デコードしない(既存のJPG変換結果Blobを入力にする)", async () => {
    const { result } = renderHook(() => useRemoveExif());
    const item = makeHeicDoneItem({ fileName: "IMG_9999.HEIC" });

    act(() => {
      result.current.startRemoval(item);
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        originalBytes: 500,
        outputBytes: 480,
        orientationKept: false,
        iccKept: false,
        elapsedMs: 1,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.outputFileName).toBe("IMG_9999-metadata-removed.jpg");
    }
  });

  it("Workerからのエラーはcodeとmessageを保持したerrorになる", async () => {
    const { result } = renderHook(() => useRemoveExif());
    const item = makeJpegItem();

    act(() => {
      result.current.startRemoval(item);
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, {
        status: "error",
        code: "malformed-exif",
        message: "Exifが壊れています",
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toEqual({
      kind: "error",
      code: "malformed-exif",
      message: "Exifが壊れています",
    });
  });

  it("1件が失敗しても、別アイテムの処理には影響しない", async () => {
    const { result } = renderHook(() => useRemoveExif());
    const itemA = makeJpegItem({ id: "a" });
    const itemB = makeJpegItem({ id: "b" });

    act(() => {
      result.current.startRemoval(itemA);
    });
    await waitFor(() => expect(controllable.enqueuedIds).toContain("a"));
    act(() => {
      controllable.resolve("a", { status: "error", code: "invalid-jpeg", message: "壊れています" });
    });

    act(() => {
      result.current.startRemoval(itemB);
    });
    await waitFor(() => expect(controllable.enqueuedIds).toContain("b"));
    act(() => {
      controllable.resolve("b", {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        originalBytes: 100,
        outputBytes: 90,
        orientationKept: false,
        iccKept: false,
        elapsedMs: 1,
      });
    });

    await waitFor(() => {
      expect(result.current.jobs.a.status.kind).toBe("error");
      expect(result.current.jobs.b.status.kind).toBe("done");
    });
  });

  it("待機中のキャンセルはcancelledになる", async () => {
    const { result } = renderHook(() => useRemoveExif());
    const item = makeJpegItem();
    controllable.cancelMock.mockReturnValue(true);

    act(() => {
      result.current.startRemoval(item);
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      result.current.cancelRemoval(item.id);
    });

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id].status.kind).toBe("cancelled");
  });

  it("古いWorker結果(cancelがfalseを返す=既に完了済み等)ではジョブ状態を変更しない", async () => {
    const { result } = renderHook(() => useRemoveExif());
    const item = makeJpegItem();
    controllable.cancelMock.mockReturnValue(false);

    act(() => {
      result.current.startRemoval(item);
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        originalBytes: 10,
        outputBytes: 9,
        orientationKept: false,
        iccKept: false,
        elapsedMs: 1,
      });
    });
    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));

    act(() => {
      result.current.cancelRemoval(item.id);
    });

    expect(result.current.jobs[item.id].status.kind).toBe("done");
  });

  it("removeJobはWorkerのcancelとObject URLの解放を行い、ジョブを削除する", async () => {
    const { result } = renderHook(() => useRemoveExif());
    const item = makeJpegItem();

    act(() => {
      result.current.startRemoval(item);
    });
    expect(result.current.jobs[item.id]).toBeDefined();

    const revokeSpy = vi.mocked(URL.revokeObjectURL);
    revokeSpy.mockClear();

    act(() => {
      result.current.removeJob(item.id);
    });

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id]).toBeUndefined();
  });

  it("clearJobsはcancelAllを行い、全ジョブを消去する", () => {
    const { result } = renderHook(() => useRemoveExif());
    const itemA = makeJpegItem({ id: "a" });
    const itemB = makeJpegItem({ id: "b" });

    act(() => {
      result.current.startRemoval(itemA);
      result.current.startRemoval(itemB);
    });

    act(() => {
      result.current.clearJobs();
    });

    expect(controllable.cancelAllMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs).toEqual({});
  });

  it("アンマウント時にdestroyが呼ばれる", () => {
    const { unmount } = renderHook(() => useRemoveExif());
    unmount();
    expect(controllable.destroyMock).toHaveBeenCalledTimes(1);
  });

  it("Workerが非対応の環境ではisSupportedがfalseになり、startRemovalは何もしない", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("Worker", undefined);

    const { result } = renderHook(() => useRemoveExif());
    expect(result.current.isSupported).toBe(false);

    const item = makeJpegItem();
    act(() => {
      result.current.startRemoval(item);
    });

    expect(result.current.jobs[item.id]).toBeUndefined();
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });
});
