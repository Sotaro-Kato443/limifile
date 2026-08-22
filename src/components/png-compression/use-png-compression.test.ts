import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPngCompressionClient } from "./png-compression-client";
import { eligibilityFor, usePngCompression } from "./use-png-compression";
import { ja } from "../../i18n/dictionaries/ja";
import { MAX_PNG_COMPRESSION_INPUT_BYTES } from "./png-compression-types";
import type { PngCompressionClient } from "./png-compression-client";
import type { PngCompressionOutcome } from "./png-compression-types";
import type { IntakeItem } from "../image-intake/types";

vi.mock("./png-compression-client", () => ({
  createPngCompressionClient: vi.fn(),
  detectPngCompressionSupport: vi.fn(() => true),
}));

interface ControllableClient {
  client: PngCompressionClient;
  enqueuedIds: string[];
  enqueuedBuffers: ArrayBuffer[];
  /** idに対する最も古い未解決呼び出しのonStartを呼ぶ */
  start(id: string): void;
  /** idに対する最も古い未解決呼び出しをoutcomeで解決する(同一idで複数回enqueueされた
   * 場合、古い方から順にFIFOで解決される。stale outcomeのテストで、後から発行された
   * 2回目のenqueueより前に1回目のenqueueへ遅れて応答が返るケースを再現するために使う) */
  resolve(id: string, outcome: PngCompressionOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
  destroyMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  const pending = new Map<
    string,
    Array<{ resolve: (outcome: PngCompressionOutcome) => void; onStart?: () => void }>
  >();
  const enqueuedIds: string[] = [];
  const enqueuedBuffers: ArrayBuffer[] = [];

  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const destroyMock = vi.fn();

  const client: PngCompressionClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      enqueuedBuffers.push(task.buffer);
      return new Promise<PngCompressionOutcome>((resolve) => {
        const list = pending.get(task.id) ?? [];
        list.push({ resolve, onStart: callbacks?.onStart });
        pending.set(task.id, list);
      });
    }),
    cancel: cancelMock,
    cancelAll: cancelAllMock,
    destroy: destroyMock,
  };

  return {
    client,
    enqueuedIds,
    enqueuedBuffers,
    start(id) {
      pending.get(id)?.[0]?.onStart?.();
    },
    resolve(id, outcome) {
      const list = pending.get(id);
      if (!list || list.length === 0) return;
      const entry = list.shift()!;
      entry.resolve(outcome);
    },
    cancelMock,
    cancelAllMock,
    destroyMock,
  };
}

/** File.arrayBuffer()の解決タイミングを手動制御するためのFileを作る。
 * 同一Fileへ複数回arrayBuffer()を呼んでも常に同じPromiseを返す(実ブラウザの挙動そのものを
 * 厳密には模していないが、「同一アイテムの古い読み込みが遅れて解決する」ケースの
 * テストには十分)。 */
function makeDeferredFile(name: string, size = 4) {
  const file = new File([new Uint8Array(size)], name, { type: "image/png" });
  let resolveFn!: (buffer: ArrayBuffer) => void;
  let rejectFn!: (error: unknown) => void;
  let callCount = 0;
  const promise = new Promise<ArrayBuffer>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: () => {
      callCount += 1;
      return promise;
    },
    configurable: true,
  });
  return {
    file,
    resolve: (buffer: ArrayBuffer = new ArrayBuffer(size)) => resolveFn(buffer),
    reject: (error: unknown) => rejectFn(error),
    get callCount() {
      return callCount;
    },
  };
}

/** マイクロタスクを複数回消化する(myTurn→readPromise→enqueueのような複数段のawaitを
 * 挟む非同期処理が、値の変化を伴わずに完了しているであろうことを確認するために使う)。 */
async function flushAsync(times = 10) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

function makePngItem(
  overrides: {
    id?: string;
    fileName?: string;
    width?: number;
    height?: number;
    size?: number;
    file?: File;
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.png";
  const size = overrides.size ?? 4;
  const file = overrides.file ?? new File([new Uint8Array(size)], fileName, { type: "image/png" });
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
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", { type: "image/jpeg" });
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

function doneOutcome(overrides: Partial<Extract<PngCompressionOutcome, { status: "done" }>> = {}) {
  return {
    status: "done" as const,
    pngBuffer: new ArrayBuffer(4),
    pngType: "image/png" as const,
    originalBytes: 10000,
    outputBytes: 4000,
    originalWidth: 500,
    originalHeight: 500,
    outputWidth: 500,
    outputHeight: 500,
    colorCount: 16,
    encodeCount: 3,
    originalReturned: false,
    ...overrides,
  };
}

const TARGET_500KB = { bytes: 500_000, label: "500kb", displayText: "500KB" };

describe("eligibilityFor", () => {
  it("非対応ブラウザでは常にunsupported-browserを返す", () => {
    expect(eligibilityFor(makePngItem(), false)).toEqual({ kind: "unsupported-browser" });
  });

  it("PNGはready(source有り)を返す", () => {
    const result = eligibilityFor(makePngItem(), true);
    expect(result.kind).toBe("ready");
  });

  it("JPEGはunsupported-formatを返す", () => {
    /**
     * allowedFormats(PngCompressionWorkbench: ["png"])によりJPEGはintake時点で
     * unsupported-formatとして拒否されるため、"ready"ではなくintake拒否後の状態を再現する。
     */
    const item = { ...makeJpegItem(), status: { kind: "unsupported-format" as const } };
    expect(eligibilityFor(item, true)).toEqual({ kind: "unsupported-format" });
  });

  it("解析中等はnot-readyを返す", () => {
    expect(eligibilityFor(makeNotReadyItem(), true)).toEqual({ kind: "not-ready" });
  });
});

describe("usePngCompression", () => {
  let controllable: ControllableClient;

  beforeEach(() => {
    controllable = createControllableClient();
    vi.mocked(createPngCompressionClient).mockReturnValue(controllable.client);
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:mock-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("通常フロー: queued→processing→doneと遷移し、出力ファイル名がベース名+compressedになる", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem({ fileName: "photo.png" });

    act(() => result.current.startCompression(item, TARGET_500KB));
    expect(result.current.jobs[item.id].status.kind).toBe("queued");

    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    act(() => controllable.start(item.id));
    expect(result.current.jobs[item.id].status.kind).toBe("processing");

    act(() => controllable.resolve(item.id, doneOutcome()));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.outputFileName).toBe("photo-compressed.png");
      expect(job.status.result.originalReturned).toBe(false);
      expect(job.status.result.colorCount).toBe(16);
      expect(job.status.result.blob.type).toBe("image/png");
    }
  });

  it("targetBytesがWorkerへ正しく渡される", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem();

    act(() => result.current.startCompression(item, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    expect(controllable.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ targetBytes: 500_000 }),
      expect.anything(),
    );
  });

  it("originalReturned=trueの場合、colorCountはnullのまま伝わる", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem();

    act(() => result.current.startCompression(item, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    act(() =>
      controllable.resolve(
        item.id,
        doneOutcome({ originalReturned: true, colorCount: null, outputBytes: 10000 }),
      ),
    );

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "done") {
      expect(job.status.result.originalReturned).toBe(true);
      expect(job.status.result.colorCount).toBeNull();
    }
  });

  it("unreachable+bestCandidateの場合、最小化ファイル名になる", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem({ fileName: "photo.png" });

    act(() => result.current.startCompression(item, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    act(() =>
      controllable.resolve(item.id, {
        status: "unreachable",
        encodeCount: 24,
        bestCandidate: {
          pngBuffer: new ArrayBuffer(4),
          outputBytes: 900_000,
          outputWidth: 500,
          outputHeight: 500,
          colorCount: 2,
        },
      }),
    );

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("unreachable"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "unreachable") {
      expect(job.status.result.bestCandidate?.outputFileName).toBe("photo-minimized.png");
      expect(job.status.result.bestCandidate?.blob.type).toBe("image/png");
      expect(job.status.result.targetBytes).toBe(500_000);
    }
  });

  it("unreachableでbestCandidateが無い場合、resultにbestCandidateが含まれない", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem();

    act(() => result.current.startCompression(item, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    act(() => controllable.resolve(item.id, { status: "unreachable", encodeCount: 24 }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("unreachable"));
    const job = result.current.jobs[item.id];
    if (job.status.kind === "unreachable") {
      expect(job.status.result.bestCandidate).toBeUndefined();
    }
  });

  it.each([
    ["animated-png", "アニメーションPNG(APNG)は現在対応していません。"],
    ["invalid-png", "このファイルを有効なPNG画像として読み込めませんでした。"],
    ["invalid-target", "指定容量を確認してください。"],
    ["unsafe-dimensions", "画像の縦横サイズまたは総ピクセル数が処理上限を超えています。"],
    ["unsupported-browser", "このブラウザではPNG圧縮機能を利用できません。"],
    ["unsupported-png-encoder", "PNGの生成結果を安全に確認できませんでした。"],
    ["timeout", "処理が時間上限を超えました。より小さい画像でお試しください。"],
  ] as const)("Workerが%sを返した場合、固定文言のerrorになる", async (status, message) => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem();

    act(() => result.current.startCompression(item, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    act(() => controllable.resolve(item.id, { status } as PngCompressionOutcome));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: status,
      message,
    });
  });

  it("Workerがerrorを返した場合、固定文言のerrorになる(内部メッセージを画面に出さない)", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem();

    act(() => result.current.startCompression(item, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
    act(() => controllable.resolve(item.id, { status: "error", message: "内部の技術的詳細" }));

    await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("error"));
    const status = result.current.jobs[item.id].status;
    expect(status).toMatchObject({ kind: "error", reason: "error" });
    if (status.kind === "error") {
      expect(status.message).not.toContain("内部の技術的詳細");
    }
  });

  it("50MiB以下のファイルは受け付けてenqueueする", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem({ size: MAX_PNG_COMPRESSION_INPUT_BYTES });

    act(() => result.current.startCompression(item, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
  });

  it("50MiB超のファイルはWorkerへ送信せず、arrayBufferも呼ばずtoo-largeエラーを表示する", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem({ size: MAX_PNG_COMPRESSION_INPUT_BYTES + 1 });
    const arrayBufferSpy = vi.spyOn(item.file, "arrayBuffer");

    act(() => result.current.startCompression(item, TARGET_500KB));

    expect(result.current.jobs[item.id].status).toMatchObject({
      kind: "error",
      reason: "too-large",
      message: "ファイルのサイズが大きすぎるため処理できません(上限50MB)。",
    });
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("1件が失敗しても、別アイテムの処理には影響しない", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const itemA = makePngItem({ id: "a", fileName: "a.png" });
    const itemB = makePngItem({ id: "b", fileName: "b.png" });

    act(() => result.current.startCompression(itemA, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toContain("a"));
    act(() => controllable.resolve("a", { status: "invalid-png" }));

    act(() => result.current.startCompression(itemB, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toContain("b"));
    act(() => controllable.resolve("b", doneOutcome()));

    await waitFor(() => {
      expect(result.current.jobs.a.status.kind).toBe("error");
      expect(result.current.jobs.b.status.kind).toBe("done");
    });
  });

  it("待機中のキャンセルはcancelledになる", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem();
    controllable.cancelMock.mockReturnValue(true);

    act(() => result.current.startCompression(item, TARGET_500KB));
    await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

    act(() => result.current.cancelCompression(item.id));

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id].status.kind).toBe("cancelled");
  });

  it("removeJobはWorkerのcancelとObject URLの解放を行い、ジョブを削除する", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const item = makePngItem();

    act(() => result.current.startCompression(item, TARGET_500KB));
    expect(result.current.jobs[item.id]).toBeDefined();

    act(() => result.current.removeJob(item.id));

    expect(controllable.cancelMock).toHaveBeenCalledWith(item.id);
    expect(result.current.jobs[item.id]).toBeUndefined();
  });

  it("clearJobsはcancelAllを行い、全ジョブを消去する", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const itemA = makePngItem({ id: "a", fileName: "a.png" });
    const itemB = makePngItem({ id: "b", fileName: "b.png" });

    act(() => {
      result.current.startCompression(itemA, TARGET_500KB);
      result.current.startCompression(itemB, TARGET_500KB);
    });

    act(() => result.current.clearJobs());

    expect(controllable.cancelAllMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs).toEqual({});
  });

  it("アンマウント時にdestroyが呼ばれる", () => {
    const { unmount } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    unmount();
    expect(controllable.destroyMock).toHaveBeenCalledTimes(1);
  });

  it("同一ファイル名を複数選択しても別アイテムIDとして独立して扱う", async () => {
    const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
    const itemA = makePngItem({ id: "a", fileName: "photo.png" });
    const itemB = makePngItem({ id: "b", fileName: "photo.png" });

    act(() => {
      result.current.startCompression(itemA, TARGET_500KB);
      result.current.startCompression(itemB, TARGET_500KB);
    });

    await waitFor(() => expect(controllable.enqueuedIds).toEqual(["a", "b"]));
    expect(result.current.jobs.a).toBeDefined();
    expect(result.current.jobs.b).toBeDefined();
  });

  describe("arrayBuffer読み込み中の競合", () => {
    it("読み込み中にremoveJobすると、読み込み完了後もenqueueされずjobsへ復活しない", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const deferred = makeDeferredFile("photo.png");
      const item = makePngItem({ file: deferred.file });

      act(() => result.current.startCompression(item, TARGET_500KB));
      expect(result.current.jobs[item.id].status.kind).toBe("queued");

      act(() => result.current.removeJob(item.id));
      expect(result.current.jobs[item.id]).toBeUndefined();

      act(() => deferred.resolve());
      await flushAsync();

      expect(controllable.enqueuedIds).toEqual([]);
      expect(result.current.jobs[item.id]).toBeUndefined();
    });

    it("読み込み中にclearJobsすると、読み込み完了後もenqueueされない", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const deferred = makeDeferredFile("photo.png");
      const item = makePngItem({ file: deferred.file });

      act(() => result.current.startCompression(item, TARGET_500KB));
      act(() => result.current.clearJobs());
      expect(result.current.jobs).toEqual({});

      act(() => deferred.resolve());
      await flushAsync();

      expect(controllable.enqueuedIds).toEqual([]);
      expect(result.current.jobs).toEqual({});
    });

    it("読み込み中にunmountすると、読み込み完了後もenqueueされずstate更新・Object URL生成も行われない", async () => {
      const { result, unmount } = renderHook(() =>
        usePngCompression(ja.ui.pngCompression.panel.errors),
      );
      const deferred = makeDeferredFile("photo.png");
      const item = makePngItem({ file: deferred.file });

      act(() => result.current.startCompression(item, TARGET_500KB));
      unmount();

      const createObjectURLSpy = vi.mocked(URL.createObjectURL);
      const beforeCallCount = createObjectURLSpy.mock.calls.length;

      act(() => deferred.resolve());
      await flushAsync();

      expect(controllable.enqueuedIds).toEqual([]);
      expect(createObjectURLSpy.mock.calls.length).toBe(beforeCallCount);
      expect(controllable.destroyMock).toHaveBeenCalledTimes(1);
    });

    it("同一アイテムの読み込み中に再圧縮すると、古い要求はenqueueされず新しいtargetだけが使われる", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const deferred = makeDeferredFile("photo.png");
      const item = makePngItem({ file: deferred.file });
      const target2 = { bytes: 200_000, label: "200kb", displayText: "200KB" };

      act(() => result.current.startCompression(item, TARGET_500KB));
      act(() => result.current.startCompression(item, target2));

      act(() => deferred.resolve());
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

      expect(controllable.client.enqueue).toHaveBeenCalledTimes(1);
      expect(controllable.client.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ targetBytes: 200_000 }),
        expect.anything(),
      );
    });

    it("2ファイルのarrayBufferが逆順で完了しても、enqueue順は開始要求順を維持する(FIFO)", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const deferredA = makeDeferredFile("a.png");
      const deferredB = makeDeferredFile("b.png");
      const itemA = makePngItem({ id: "a", file: deferredA.file });
      const itemB = makePngItem({ id: "b", file: deferredB.file });

      act(() => result.current.startCompression(itemA, TARGET_500KB));
      act(() => result.current.startCompression(itemB, TARGET_500KB));

      // Bの方が先に読み込みが完了する(Aより後に開始したが先に終わるケース)
      act(() => deferredB.resolve());
      await flushAsync();
      // Aがまだ自分の番を待っているため、Bはまだenqueueされていないはず
      expect(controllable.enqueuedIds).toEqual([]);

      act(() => deferredA.resolve());
      await waitFor(() => expect(controllable.enqueuedIds).toEqual(["a", "b"]));
    });

    it("arrayBufferが失敗した場合、error状態になりunhandled rejectionを起こさず次のタスクが続行する", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const deferredA = makeDeferredFile("a.png");
      const itemA = makePngItem({ id: "a", file: deferredA.file });
      const itemB = makePngItem({ id: "b", fileName: "b.png" });

      act(() => result.current.startCompression(itemA, TARGET_500KB));
      act(() => deferredA.reject(new Error("read failed")));

      await waitFor(() => expect(result.current.jobs.a.status.kind).toBe("error"));
      const statusA = result.current.jobs.a.status;
      expect(statusA).toMatchObject({ kind: "error", reason: "error" });
      if (statusA.kind === "error") {
        expect(statusA.message).not.toContain("read failed");
      }
      expect(controllable.enqueuedIds).not.toContain("a");

      act(() => result.current.startCompression(itemB, TARGET_500KB));
      await waitFor(() => expect(controllable.enqueuedIds).toContain("b"));
      act(() => controllable.resolve("b", doneOutcome()));
      await waitFor(() => expect(result.current.jobs.b.status.kind).toBe("done"));
    });
  });

  describe("stale outcomeの無視", () => {
    it("削除後に古いdone結果が返ってきても、jobsへ復活しない", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const item = makePngItem();

      act(() => result.current.startCompression(item, TARGET_500KB));
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

      act(() => result.current.removeJob(item.id));
      expect(result.current.jobs[item.id]).toBeUndefined();

      act(() => controllable.resolve(item.id, doneOutcome()));
      await flushAsync();

      expect(result.current.jobs[item.id]).toBeUndefined();
    });

    it("clear後に古いunreachable結果が返ってきても、bestCandidateのObject URLを作らない", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const item = makePngItem();

      act(() => result.current.startCompression(item, TARGET_500KB));
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));

      act(() => result.current.clearJobs());

      const createObjectURLSpy = vi.mocked(URL.createObjectURL);
      const beforeCallCount = createObjectURLSpy.mock.calls.length;

      act(() =>
        controllable.resolve(item.id, {
          status: "unreachable",
          encodeCount: 1,
          bestCandidate: {
            pngBuffer: new ArrayBuffer(4),
            outputBytes: 900_000,
            outputWidth: 500,
            outputHeight: 500,
            colorCount: 2,
          },
        }),
      );
      await flushAsync();

      expect(createObjectURLSpy.mock.calls.length).toBe(beforeCallCount);
      expect(result.current.jobs).toEqual({});
    });

    it("再圧縮後に古いWorker応答が新しい結果を上書きしない", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const item = makePngItem();

      act(() => result.current.startCompression(item, TARGET_500KB));
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
      act(() => controllable.start(item.id));

      act(() =>
        result.current.startCompression(item, {
          bytes: 200_000,
          label: "200kb",
          displayText: "200KB",
        }),
      );
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id, item.id]));

      // 古い(1回目の)Worker呼び出しが遅れてdoneを返しても、jobは上書きされない
      act(() => controllable.resolve(item.id, doneOutcome({ outputBytes: 111 })));
      await flushAsync();
      expect(result.current.jobs[item.id].status.kind).not.toBe("done");

      // 新しい(2回目の)呼び出しの結果は正しく反映される
      act(() => controllable.resolve(item.id, doneOutcome({ outputBytes: 222 })));
      await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));
      const job = result.current.jobs[item.id];
      if (job.status.kind === "done") {
        expect(job.status.result.outputBytes).toBe(222);
      }
    });
  });

  describe("invalidateForTargetChange", () => {
    it("done結果表示後に呼ぶと、needs-reprocessへ遷移しObject URLを解放する", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const item = makePngItem();

      act(() => result.current.startCompression(item, TARGET_500KB));
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
      act(() => controllable.resolve(item.id, doneOutcome()));
      await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("done"));

      const revokeSpy = vi.mocked(URL.revokeObjectURL);
      const beforeCallCount = revokeSpy.mock.calls.length;

      act(() => result.current.invalidateForTargetChange(item.id));

      expect(result.current.jobs[item.id].status.kind).toBe("needs-reprocess");
      expect(revokeSpy.mock.calls.length).toBeGreaterThan(beforeCallCount);
    });

    it("unreachable+bestCandidate表示後に呼ぶと、bestCandidateのObject URLも解放される", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const item = makePngItem();

      act(() => result.current.startCompression(item, TARGET_500KB));
      await waitFor(() => expect(controllable.enqueuedIds).toEqual([item.id]));
      act(() =>
        controllable.resolve(item.id, {
          status: "unreachable",
          encodeCount: 1,
          bestCandidate: {
            pngBuffer: new ArrayBuffer(4),
            outputBytes: 900_000,
            outputWidth: 500,
            outputHeight: 500,
            colorCount: 2,
          },
        }),
      );
      await waitFor(() => expect(result.current.jobs[item.id].status.kind).toBe("unreachable"));

      const revokeSpy = vi.mocked(URL.revokeObjectURL);
      revokeSpy.mockClear();

      act(() => result.current.invalidateForTargetChange(item.id));

      expect(result.current.jobs[item.id].status.kind).toBe("needs-reprocess");
      // unreachableではresultUrlId(主結果用)は元々作られていないため、
      // 実際にrevokeObjectURLが呼ばれるのはbestCandidateUrlIdの1件のみ
      // (object-url-managerのrevoke()は未作成のidに対しては安全にno-opする)
      expect(revokeSpy).toHaveBeenCalledTimes(1);
    });

    it("queued/processing中、または未着手の場合は何もしない", async () => {
      const { result } = renderHook(() => usePngCompression(ja.ui.pngCompression.panel.errors));
      const item = makePngItem();

      // 未着手(jobが存在しない)
      act(() => result.current.invalidateForTargetChange(item.id));
      expect(result.current.jobs[item.id]).toBeUndefined();

      act(() => result.current.startCompression(item, TARGET_500KB));
      expect(result.current.jobs[item.id].status.kind).toBe("queued");

      act(() => result.current.invalidateForTargetChange(item.id));
      expect(result.current.jobs[item.id].status.kind).toBe("queued");
    });
  });
});
