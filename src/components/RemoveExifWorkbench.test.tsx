import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoveExifWorkbench } from "./RemoveExifWorkbench";
import { createHeicConversionClient } from "./image-intake/heic-conversion-client";
import { createRemoveExifClient } from "./image-intake/remove-exif-client";
import type {
  HeicConversionClient,
  HeicConvertOutcome,
} from "./image-intake/heic-conversion-client";
import type { RemoveExifClient, RemoveExifOutcome } from "./image-intake/remove-exif-client";

vi.mock("./image-intake/heic-conversion-client", () => ({
  createHeicConversionClient: vi.fn(),
}));
vi.mock("./image-intake/remove-exif-client", () => ({
  createRemoveExifClient: vi.fn(),
}));

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const WEBP_BYTES = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

function createFile(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

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

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function ascii4(t: string): number[] {
  return t.split("").map((c) => c.charCodeAt(0));
}
function box(type: string, payload: number[]): number[] {
  return [...u32be(8 + payload.length), ...ascii4(type), ...payload];
}
function createAvifFile(name: string): File {
  const ftyp = box("ftyp", [...ascii4("avif"), ...u32be(0), ...ascii4("mif1"), ...ascii4("miaf")]);
  const ispe = box("ispe", [...u32be(0), ...u32be(500), ...u32be(500)]);
  const ipco = box("ipco", ispe);
  const iprp = box("iprp", ipco);
  const meta = box("meta", [...u32be(0), ...iprp]);
  return new File([new Uint8Array([...ftyp, ...meta])], name, { type: "image/avif" });
}

interface ControllableHeicClient {
  client: HeicConversionClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: HeicConvertOutcome): void;
}

function createControllableHeicClient(): ControllableHeicClient {
  const resolvers = new Map<string, (outcome: HeicConvertOutcome) => void>();
  const enqueuedIds: string[] = [];
  const client: HeicConversionClient = {
    enqueue: vi.fn((task) => {
      enqueuedIds.push(task.id);
      return new Promise<HeicConvertOutcome>((resolve) => resolvers.set(task.id, resolve));
    }),
    cancel: vi.fn(() => false),
    cancelAll: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    client,
    enqueuedIds,
    resolve(id, outcome) {
      resolvers.get(id)?.(outcome);
      resolvers.delete(id);
    },
  };
}

interface ControllableRemoveExifClient {
  client: RemoveExifClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: RemoveExifOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
}

function createControllableRemoveExifClient(): ControllableRemoveExifClient {
  const resolvers = new Map<string, (outcome: RemoveExifOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const client: RemoveExifClient = {
    enqueue: vi.fn((task) => {
      enqueuedIds.push(task.id);
      return new Promise<RemoveExifOutcome>((resolve) => resolvers.set(task.id, resolve));
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

function selectFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 600;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe("RemoveExifWorkbench", () => {
  let heic: ControllableHeicClient;
  let removeExif: ControllableRemoveExifClient;

  beforeEach(() => {
    heic = createControllableHeicClient();
    removeExif = createControllableRemoveExifClient();
    vi.mocked(createHeicConversionClient).mockReturnValue(heic.client);
    vi.mocked(createRemoveExifClient).mockReturnValue(removeExif.client);

    vi.stubGlobal("Image", StubImage);
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

  it("JPEGを選択すると削除開始ボタンが表示される", async () => {
    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "メタデータを削除する" })).toBeInTheDocument();
    });
  });

  it("PNG/WebPを選択すると「メタデータ削除は現在JPEG・HEICに対応しています」と表示され、削除開始ボタンは出ない", async () => {
    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [
      createFile(PNG_BYTES, "photo.png", "image/png"),
      createFile(WEBP_BYTES, "photo.webp", "image/webp"),
    ]);

    await waitFor(() => {
      expect(screen.getAllByText("メタデータ削除は現在JPEG・HEICに対応しています")).toHaveLength(2);
    });
    expect(screen.queryByRole("button", { name: "メタデータを削除する" })).not.toBeInTheDocument();
  });

  it("AVIFを選択すると「メタデータ削除は現在JPEG・HEICに対応しています」と表示され、AVIF全体のpreflight(file.arrayBuffer)を開始しない", async () => {
    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    const avifFile = createAvifFile("photo.avif");
    const arrayBufferSpy = vi.spyOn(avifFile, "arrayBuffer");
    selectFiles(input, [avifFile]);

    await waitFor(() => {
      expect(
        screen.getByText("メタデータ削除は現在JPEG・HEICに対応しています"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "メタデータを削除する" })).not.toBeInTheDocument();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("HEIC変換完了後、「HEICはJPGに変換したうえでメタデータを削除します」と表示し、削除パネルが使える", async () => {
    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createHeicFile("photo.heic")]);

    await waitFor(() => expect(heic.enqueuedIds).toHaveLength(1));
    heic.resolve(heic.enqueuedIds[0], {
      status: "done",
      jpegBuffer: new ArrayBuffer(8),
      jpegType: "image/jpeg",
      width: 4032,
      height: 3024,
    });

    await waitFor(() => {
      expect(
        screen.getByText("HEICはJPGに変換したうえでメタデータを削除します"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "メタデータを削除する" })).toBeInTheDocument();
    });
  });

  it("削除するを押すと削除が実行され、成功時にJPGを確認/JPGを保存が表示される", async () => {
    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "メタデータを削除する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "メタデータを削除する" }));

    await waitFor(() => expect(removeExif.enqueuedIds).toHaveLength(1));

    removeExif.resolve(removeExif.enqueuedIds[0], {
      status: "done",
      jpegBuffer: new ArrayBuffer(4),
      originalBytes: 1000,
      outputBytes: 900,
      orientationKept: false,
      iccKept: true,
      elapsedMs: 2,
    });

    await waitFor(() => {
      expect(screen.getByText("メタデータを削除しました")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "JPGを確認" })).toBeInTheDocument();
  });

  it("1件が失敗しても、他のファイルの選択・処理には影響しない", async () => {
    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [
      createFile(JPEG_BYTES, "broken.jpg", "image/jpeg"),
      createFile(JPEG_BYTES, "ok.jpg", "image/jpeg"),
    ]);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "メタデータを削除する" })).toHaveLength(2),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "メタデータを削除する" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "メタデータを削除する" })[1]);

    await waitFor(() => expect(removeExif.enqueuedIds).toHaveLength(2));

    removeExif.resolve(removeExif.enqueuedIds[0], {
      status: "error",
      code: "invalid-jpeg",
      message: "壊れています",
    });
    removeExif.resolve(removeExif.enqueuedIds[1], {
      status: "done",
      jpegBuffer: new ArrayBuffer(4),
      originalBytes: 100,
      outputBytes: 90,
      orientationKept: false,
      iccKept: false,
      elapsedMs: 1,
    });

    await waitFor(() => {
      expect(
        screen.getByText("JPEGとして読み取れませんでした。ファイルが壊れている可能性があります。"),
      ).toBeInTheDocument();
      expect(screen.getByText("メタデータを削除しました")).toBeInTheDocument();
    });
  });

  it("個別削除するとクライアントのcancelが呼ばれる", async () => {
    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "メタデータを削除する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "photo.jpgを削除" }));

    expect(removeExif.cancelMock).toHaveBeenCalled();
    expect(screen.queryByText("photo.jpg")).not.toBeInTheDocument();
  });

  it("すべて削除するとクライアントのcancelAllが呼ばれる", async () => {
    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "メタデータを削除する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));

    expect(removeExif.cancelAllMock).toHaveBeenCalledTimes(1);
  });

  it("Worker等が非対応の環境では非対応バナーを表示する", async () => {
    vi.stubGlobal("Worker", undefined);
    render(<RemoveExifWorkbench locale="ja" />);

    expect(
      screen.getByText("このブラウザはメタデータ削除に必要な機能へ対応していません"),
    ).toBeInTheDocument();

    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "メタデータを削除する" })).not.toBeInTheDocument();
  });

  it("画像選択操作や削除処理フローで外部通信は発生しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sendSpy = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);

    render(<RemoveExifWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "メタデータを削除する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "メタデータを削除する" }));
    await waitFor(() => expect(removeExif.enqueuedIds).toHaveLength(1));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  describe("locale=en", () => {
    it("英語文言でレンダーされ、既存の日本語UI文言が残らない", () => {
      const { container } = render(<RemoveExifWorkbench locale="en" />);
      expect(screen.getByText("Select an image, or drag and drop it here")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Your images are processed on this device and are never sent to a server.",
        ),
      ).toBeInTheDocument();

      const text = container.textContent ?? "";
      expect(text).not.toContain("画像を選択、またはここにドラッグ&ドロップ");
      expect(text).not.toContain("画像はこの端末内で処理され");
      expect(text).not.toContain("メタデータを削除する");
    });
  });
});
