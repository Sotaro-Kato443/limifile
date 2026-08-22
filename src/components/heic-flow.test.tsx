import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageWorkbench } from "./ImageWorkbench";
import { createHeicConversionClient } from "./image-intake/heic-conversion-client";
import type {
  HeicConversionClient,
  HeicConvertOutcome,
} from "./image-intake/heic-conversion-client";

/**
 * @discourse/heicのデコード自体はheic-conversion-client.test.ts / heic-convert.worker.test.tsで
 * 個別に検証済みのため、ここではheic-conversion-clientモジュールをモックし、
 * ImageWorkbench〜use-image-intakeの状態遷移・UI表示・キャンセル連携のみを検証する。
 */
vi.mock("./image-intake/heic-conversion-client", () => ({
  createHeicConversionClient: vi.fn(),
}));

function buildFtypBytes(majorBrand: string, compatibleBrands: string[] = []) {
  const totalSize = 16 + compatibleBrands.length * 4;
  const bytes = new Uint8Array(totalSize);
  bytes[0] = (totalSize >>> 24) & 0xff;
  bytes[1] = (totalSize >>> 16) & 0xff;
  bytes[2] = (totalSize >>> 8) & 0xff;
  bytes[3] = totalSize & 0xff;
  "ftyp".split("").forEach((c, i) => (bytes[4 + i] = c.charCodeAt(0)));
  majorBrand.split("").forEach((c, i) => (bytes[8 + i] = c.charCodeAt(0)));
  compatibleBrands.forEach((brand, brandIndex) => {
    brand.split("").forEach((c, i) => (bytes[16 + brandIndex * 4 + i] = c.charCodeAt(0)));
  });
  return bytes;
}

function createHeicFile(name: string): File {
  const bytes = buildFtypBytes("heic", ["mif1", "heix", "hevc"]);
  return new File([bytes], name, { type: "image/heic" });
}

interface ControllableClient {
  client: HeicConversionClient;
  enqueuedIds: string[];
  start(id: string): void;
  resolve(id: string, outcome: HeicConvertOutcome): void;
}

function createControllableHeicClient(): ControllableClient {
  const resolvers = new Map<string, (outcome: HeicConvertOutcome) => void>();
  const starters = new Map<string, () => void>();
  const enqueuedIds: string[] = [];

  const client: HeicConversionClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      if (callbacks?.onStart) starters.set(task.id, callbacks.onStart);
      return new Promise<HeicConvertOutcome>((resolve) => {
        resolvers.set(task.id, resolve);
      });
    }),
    cancel: vi.fn(() => false),
    cancelAll: vi.fn(),
    destroy: vi.fn(),
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
  };
}

/** MAX_HEIC_INPUT_BYTES(50MiB)判定用に、指定バイト数のHEICファイルを生成する */
function createHeicFileWithSize(name: string, size: number): File {
  const bytes = buildFtypBytes("heic", ["mif1", "heix", "hevc"]);
  const padded = new Uint8Array(Math.max(size, bytes.length));
  padded.set(bytes);
  return new File([padded], name, { type: "image/heic" });
}

describe("HEIC変換フロー(heic-conversion-clientをモック)", () => {
  let controllable: ControllableClient;

  beforeEach(() => {
    controllable = createControllableHeicClient();
    vi.mocked(createHeicConversionClient).mockReturnValue(controllable.client);
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
      },
    );
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:mock-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("変換成功時: 変換待ち→変換中→完了と遷移し、容量比較とダウンロードリンクを表示する", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile("photo.heic")] } });

    await waitFor(() => {
      expect(screen.getByText("JPGへ変換待ち")).toBeInTheDocument();
    });

    const id = controllable.enqueuedIds[0];
    controllable.start(id);

    await waitFor(() => {
      expect(screen.getByText("JPGへ変換中…")).toBeInTheDocument();
    });

    controllable.resolve(id, {
      status: "done",
      jpegBuffer: new ArrayBuffer(8),
      jpegType: "image/jpeg",
      width: 4032,
      height: 3024,
    });

    await waitFor(() => {
      expect(screen.getByText("HEICを互換性の高いJPGへ変換しました")).toBeInTheDocument();
    });

    expect(screen.getByText(/変換前:/)).toBeInTheDocument();
    expect(screen.getByText(/変換後:/)).toBeInTheDocument();
    expect(screen.getByText(/4032×3024px/)).toBeInTheDocument();

    const downloadLink = screen.getByText("JPGをダウンロード") as HTMLAnchorElement;
    expect(downloadLink.getAttribute("download")).toBe("photo.jpg");
  });

  it("変換失敗時: エラー状態へ遷移しメッセージを表示する", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile("broken.heic")] } });

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));
    const id = controllable.enqueuedIds[0];
    controllable.start(id);
    controllable.resolve(id, { status: "error", message: "Decoding error" });

    await waitFor(() => {
      expect(
        screen.getByText("この画像を変換できませんでした。別のファイルでお試しください。"),
      ).toBeInTheDocument();
    });
  });

  it("複数のHEICファイルがそれぞれ変換され、1件の失敗が他に影響しない", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [createHeicFile("a.heic"), createHeicFile("b.heic")] },
    });

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(2));
    const [idA, idB] = controllable.enqueuedIds;

    controllable.start(idA);
    controllable.resolve(idA, { status: "error", message: "Decoding error" });

    controllable.start(idB);
    controllable.resolve(idB, {
      status: "done",
      jpegBuffer: new ArrayBuffer(8),
      jpegType: "image/jpeg",
      width: 100,
      height: 100,
    });

    await waitFor(() => {
      expect(
        screen.getByText("この画像を変換できませんでした。別のファイルでお試しください。"),
      ).toBeInTheDocument();
      expect(screen.getByText("HEICを互換性の高いJPGへ変換しました")).toBeInTheDocument();
    });
  });

  it("待機中のHEICファイルを削除するとcancelが呼ばれる", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile("queued.heic")] } });

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "queued.heicを削除" }));

    expect(controllable.client.cancel).toHaveBeenCalledWith(controllable.enqueuedIds[0]);
  });

  it("実行中(変換中)のHEICファイルを削除するとcancelが呼ばれ、削除後に別のHEICを正常に処理できる", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile("running.heic")] } });

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));
    const id = controllable.enqueuedIds[0];
    controllable.start(id);
    await waitFor(() => expect(screen.getByText("JPGへ変換中…")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "running.heicを削除" }));
    expect(controllable.client.cancel).toHaveBeenCalledWith(id);
    expect(screen.queryByText("running.heic")).not.toBeInTheDocument();

    // 削除後、遅延してcancelledが返っても一覧へ復活しない
    controllable.resolve(id, { status: "cancelled" });
    await Promise.resolve();
    expect(screen.queryByText("running.heic")).not.toBeInTheDocument();

    // 削除後、別のHEICファイルを正常に処理できる
    fireEvent.change(input, { target: { files: [createHeicFile("next.heic")] } });
    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(2));
    const nextId = controllable.enqueuedIds[1];
    controllable.start(nextId);
    controllable.resolve(nextId, {
      status: "done",
      jpegBuffer: new ArrayBuffer(8),
      jpegType: "image/jpeg",
      width: 20,
      height: 20,
    });

    await waitFor(() => {
      expect(screen.getByText("HEICを互換性の高いJPGへ変換しました")).toBeInTheDocument();
    });
  });

  it("すべて削除するとcancelAllが呼ばれる", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile("x.heic")] } });

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));

    expect(controllable.client.cancelAll).toHaveBeenCalledTimes(1);
  });

  it("アンマウント時にdestroyが呼ばれる", async () => {
    const { unmount } = render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile("y.heic")] } });

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));

    unmount();

    expect(controllable.client.destroy).toHaveBeenCalledTimes(1);
  });

  it("変換後、個別削除すると元ファイルと変換後JPEGの両方のObject URLが解放される", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile("z.heic")] } });

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));
    const id = controllable.enqueuedIds[0];
    controllable.start(id);
    controllable.resolve(id, {
      status: "done",
      jpegBuffer: new ArrayBuffer(8),
      jpegType: "image/jpeg",
      width: 10,
      height: 10,
    });

    await waitFor(() => {
      expect(screen.getByText("HEICを互換性の高いJPGへ変換しました")).toBeInTheDocument();
    });

    const revokeSpy = vi.mocked(URL.revokeObjectURL);
    revokeSpy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "z.heicを削除" }));

    // 元ファイル用と変換後JPEG用、2つのObject URLが解放される
    expect(revokeSpy).toHaveBeenCalledTimes(2);
  });

  it("50MiB以下のHEICファイルはWorkerへ送信される", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [createHeicFileWithSize("small.heic", 50 * 1024 * 1024)] },
    });

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));
  });

  it("50MiBを超えるHEICファイルはWorkerへ送信せず専用エラーを表示する", async () => {
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [createHeicFileWithSize("huge.heic", 50 * 1024 * 1024 + 1)] },
    });

    await waitFor(() => {
      expect(
        screen.getByText("HEICファイルのサイズが大きすぎるため処理できません(上限50MB)。"),
      ).toBeInTheDocument();
    });
    expect(controllable.enqueuedIds).toHaveLength(0);
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("HEIC変換に必要なブラウザ機能が無い場合はWorkerを生成・送信せず専用メッセージを表示する", async () => {
    vi.stubGlobal("Worker", undefined);
    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile("unsupported.heic")] } });

    await waitFor(() => {
      expect(
        screen.getByText("このブラウザではHEIC画像をJPGへ変換できません。"),
      ).toBeInTheDocument();
    });
    expect(controllable.enqueuedIds).toHaveLength(0);
    expect(controllable.client.enqueue).not.toHaveBeenCalled();
  });

  it("HEIC非対応ブラウザでもJPEG等の通常解析には影響しない", async () => {
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 800;
      naturalHeight = 600;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Worker", undefined);
    vi.stubGlobal("Image", StubImage);

    render(<ImageWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    fireEvent.change(input, {
      target: { files: [new File([jpegBytes], "photo.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(screen.getByText(/800×600px/)).toBeInTheDocument();
    });
    expect(
      screen.queryByText("このブラウザではHEIC画像をJPGへ変換できません。"),
    ).not.toBeInTheDocument();
  });
});
