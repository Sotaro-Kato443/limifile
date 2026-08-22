import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import { createTargetFitClient } from "./target-fit-client";
import { eligibilityFor, useTargetFit } from "./use-target-fit";
import { ja } from "../../i18n/dictionaries/ja";
import type { TargetFitClient, TargetFitClientOutcome } from "./target-fit-client";
import type { TargetFitRequest } from "./target-fit-types";
import type { IntakeItem } from "./types";

vi.mock("./target-fit-client", () => ({
  createTargetFitClient: vi.fn(),
}));

interface ControllableClient {
  client: TargetFitClient;
  enqueuedIds: string[];
  start(id: string): void;
  resolve(id: string, outcome: TargetFitClientOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
  destroyMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  // 同一idで複数回enqueueされる場合(re-start)に備え、id単位でFIFOキューを持つ
  // (実際のtarget-fit-client.tsは1件ずつ直列処理するため、これは「まだ解決していない
  // 古いenqueue呼び出しの結果が後から届く」ケースをテストで再現するためのもの)。
  const resolvers = new Map<string, Array<(outcome: TargetFitClientOutcome) => void>>();
  const starters = new Map<string, Array<() => void>>();
  const enqueuedIds: string[] = [];

  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const destroyMock = vi.fn();

  const client: TargetFitClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      if (callbacks?.onStart) {
        const list = starters.get(task.id) ?? [];
        list.push(callbacks.onStart);
        starters.set(task.id, list);
      }
      return new Promise<TargetFitClientOutcome>((resolve) => {
        const list = resolvers.get(task.id) ?? [];
        list.push(resolve);
        resolvers.set(task.id, list);
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
      starters.get(id)?.shift()?.();
    },
    resolve(id, outcome) {
      resolvers.get(id)?.shift()?.(outcome);
    },
    cancelMock,
    cancelAllMock,
    destroyMock,
  };
}

function makeItem(
  overrides: {
    id?: string;
    fileName?: string;
    detectedFormat?: "jpeg" | "png" | "webp" | "heic" | "avif" | null;
    status?: IntakeItem["status"];
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.jpg";
  const file = new File([new Uint8Array(1000)], fileName, { type: "image/jpeg" });
  return {
    id: overrides.id ?? "item-1",
    file,
    objectUrl: "blob:mock-original",
    extension: "jpg",
    detectedFormat: overrides.detectedFormat === undefined ? "jpeg" : overrides.detectedFormat,
    mimeType: "image/jpeg",
    extensionMismatch: false,
    status: overrides.status ?? { kind: "ready", dimensions: { width: 2000, height: 1000 } },
  };
}

function makeRequest(overrides: Partial<TargetFitRequest> = {}): TargetFitRequest {
  return {
    targetWidth: 200,
    targetHeight: 100,
    maxBytes: 50_000,
    fitMode: "contain",
    background: DEFAULT_RASTER_BACKGROUND,
    ...overrides,
  };
}

describe("eligibilityFor", () => {
  it("非対応ブラウザでは常にunsupported-browserを返す", () => {
    expect(eligibilityFor(makeItem(), false, ["jpeg", "png"])).toEqual({
      kind: "unsupported-browser",
    });
  });

  it("allowedSourceFormatsに含まれるJPEGのreadyアイテムはreadyを返す", () => {
    const result = eligibilityFor(makeItem({ detectedFormat: "jpeg" }), true, ["jpeg", "png"]);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.source.format).toBe("jpeg");
      expect(result.source.width).toBe(2000);
      expect(result.source.height).toBe(1000);
    }
  });

  it("allowedSourceFormatsに含まれるPNGのreadyアイテムもreadyを返す", () => {
    const result = eligibilityFor(makeItem({ detectedFormat: "png" }), true, ["jpeg", "png"]);
    expect(result.kind).toBe("ready");
  });

  it("allowedSourceFormatsに含まれない形式(readyだが対象外)はnot-readyを返す(hookはjpeg/pngをハードコードしない)", () => {
    const result = eligibilityFor(makeItem({ detectedFormat: "jpeg" }), true, ["png"]);
    expect(result.kind).toBe("not-ready");
  });

  it("intake側でunsupported-formatとして拒否済み(detectedFormat!==null)の場合はunsupported-formatを返す", () => {
    const item = makeItem({ detectedFormat: "webp", status: { kind: "unsupported-format" } });
    const result = eligibilityFor(item, true, ["jpeg", "png"]);
    expect(result).toEqual({ kind: "unsupported-format" });
  });

  it("detectedFormatがnull(そもそも画像として認識できない)の場合はnot-readyを返す", () => {
    const item = makeItem({ detectedFormat: null, status: { kind: "unsupported-format" } });
    const result = eligibilityFor(item, true, ["jpeg", "png"]);
    expect(result).toEqual({ kind: "not-ready" });
  });

  it("解析中等はnot-readyを返す", () => {
    const item = makeItem({ status: { kind: "analyzing" } });
    expect(eligibilityFor(item, true, ["jpeg", "png"])).toEqual({ kind: "not-ready" });
  });
});

describe("useTargetFit", () => {
  let controllable: ControllableClient;

  beforeEach(() => {
    controllable = createControllableClient();
    vi.mocked(createTargetFitClient).mockReturnValue(controllable.client);
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

  it("queued→processing→doneと遷移し、checklistが結果に含まれる", async () => {
    const { result } = renderHook(() =>
      useTargetFit(ja.ui.signatureResizer.panel.errors, ["jpeg", "png"]),
    );
    const item = makeItem();

    act(() => {
      result.current.startTargetFit(item, makeRequest());
    });

    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.start(item.id);
    });
    expect(result.current.jobs[item.id].status.kind).toBe("processing");

    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        candidate: {
          jpegBuffer: new ArrayBuffer(4),
          width: 200,
          height: 100,
          quality: 0.8,
          bytes: 40_000,
          mimeType: "image/jpeg",
          upscaled: false,
        },
        encodeCount: 3,
        elapsedMs: 500,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.checklist.width.ok).toBe(true);
      expect(job.status.result.checklist.size.ok).toBe(true);
      expect(job.status.result.outputWidth).toBe(200);
      expect(job.status.result.quality).toBe(0.8);
    }
  });

  it("unreachableはerrorではなく専用のkind:'unreachable'として、bestCandidate由来の結果を保持する", async () => {
    const { result } = renderHook(() =>
      useTargetFit(ja.ui.signatureResizer.panel.errors, ["jpeg", "png"]),
    );
    const item = makeItem();

    act(() => {
      result.current.startTargetFit(item, makeRequest({ maxBytes: 100 }));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, {
        status: "unreachable",
        bestCandidate: {
          jpegBuffer: new ArrayBuffer(4),
          width: 200,
          height: 100,
          quality: 0.35,
          bytes: 60_000,
          mimeType: "image/jpeg",
          upscaled: false,
        },
        encodeCount: 9,
        elapsedMs: 900,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("unreachable"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "unreachable") {
      expect(job.status.result.checklist.size.ok).toBe(false);
      expect(job.status.result.checklist.width.ok).toBe(true);
      expect(job.status.result.outputBytes).toBe(60_000);
    }
  });

  it("Workerからのその他のerror系statusはerror(該当reason)になる", async () => {
    const { result } = renderHook(() =>
      useTargetFit(ja.ui.signatureResizer.panel.errors, ["jpeg", "png"]),
    );
    const item = makeItem();

    act(() => {
      result.current.startTargetFit(item, makeRequest());
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      controllable.resolve(item.id, { status: "unsafe-dimensions" });
    });

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "unsafe-dimensions",
    });
  });

  it("待機中のキャンセルはcancelledになる", async () => {
    const { result } = renderHook(() =>
      useTargetFit(ja.ui.signatureResizer.panel.errors, ["jpeg", "png"]),
    );
    const item = makeItem();

    act(() => {
      result.current.startTargetFit(item, makeRequest());
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      result.current.cancelTargetFit(item.id);
    });

    expect(result.current.jobs[item.id].status.kind).toBe("cancelled");
  });

  it("removeJobはWorkerのcancelとObject URLの解放を行い、ジョブを削除する", async () => {
    const { result } = renderHook(() =>
      useTargetFit(ja.ui.signatureResizer.panel.errors, ["jpeg", "png"]),
    );
    const item = makeItem();

    act(() => {
      result.current.startTargetFit(item, makeRequest());
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      result.current.removeJob(item.id);
    });

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id]).toBeUndefined();
  });

  it("clearJobsはcancelAllを行い、全ジョブを消去する", async () => {
    const { result } = renderHook(() =>
      useTargetFit(ja.ui.signatureResizer.panel.errors, ["jpeg", "png"]),
    );
    const item = makeItem();

    act(() => {
      result.current.startTargetFit(item, makeRequest());
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      result.current.clearJobs();
    });

    expect(controllable.cancelAllMock).toHaveBeenCalled();
    expect(Object.keys(result.current.jobs)).toHaveLength(0);
  });

  it("アンマウント時にdestroyが呼ばれる", () => {
    const { unmount } = renderHook(() =>
      useTargetFit(ja.ui.signatureResizer.panel.errors, ["jpeg", "png"]),
    );
    unmount();
    expect(controllable.destroyMock).toHaveBeenCalled();
  });

  it("キャンセル後に再startした場合、古いWorker結果が届いても新しいrequestの結果を上書きしない", async () => {
    const { result } = renderHook(() =>
      useTargetFit(ja.ui.signatureResizer.panel.errors, ["jpeg", "png"]),
    );
    const item = makeItem();

    act(() => {
      result.current.startTargetFit(item, makeRequest({ maxBytes: 1000 }));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => {
      result.current.startTargetFit(item, makeRequest({ maxBytes: 2000 }));
    });
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id, item.id]));

    // 古いrequestの結果(1回目のenqueueに対応)が遅れて届いても無視される
    act(() => {
      controllable.resolve(item.id, {
        status: "error",
        message: "stale result",
      });
    });

    // 新しいrequestの結果が正しく反映される
    act(() => {
      controllable.resolve(item.id, {
        status: "done",
        candidate: {
          jpegBuffer: new ArrayBuffer(4),
          width: 200,
          height: 100,
          quality: 0.8,
          bytes: 1500,
          mimeType: "image/jpeg",
          upscaled: false,
        },
        encodeCount: 2,
        elapsedMs: 300,
      });
    });

    await waitFor(() => expect(result.current.jobs[item.id]?.status.kind).toBe("done"));
  });
});
