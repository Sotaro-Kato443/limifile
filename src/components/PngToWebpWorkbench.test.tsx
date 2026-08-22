import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PngToWebpWorkbench } from "./PngToWebpWorkbench";
import { createPngToWebpClient } from "./image-intake/png-to-webp-client";
import type { PngToWebpClient, PngToWebpOutcome } from "./image-intake/png-to-webp-client";

vi.mock("./image-intake/png-to-webp-client", () => ({
  createPngToWebpClient: vi.fn(),
}));

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];

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

function buildPngBytes(options: { width?: number; height?: number; animated?: boolean } = {}) {
  const chunks = [pngChunk("IHDR", ihdrData(options.width ?? 500, options.height ?? 500))];
  if (options.animated) chunks.push(pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]));
  chunks.push(pngChunk("IDAT", [1, 2, 3, 4]));
  chunks.push(pngChunk("IEND", []));
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]);
}

function createFile(bytes: number[] | Uint8Array, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function box(type: string, payload: number[]): number[] {
  return [...u32be(8 + payload.length), ...ascii(type), ...payload];
}
function createAvifFile(name: string): File {
  const ftyp = box("ftyp", [...ascii("avif"), ...u32be(0), ...ascii("mif1"), ...ascii("miaf")]);
  const ispe = box("ispe", [...u32be(0), ...u32be(500), ...u32be(500)]);
  const ipco = box("ipco", ispe);
  const iprp = box("iprp", ipco);
  const meta = box("meta", [...u32be(0), ...iprp]);
  return new File([new Uint8Array([...ftyp, ...meta])], name, { type: "image/avif" });
}

let nextImageShouldFail = false;
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 500;
  naturalHeight = 500;
  set src(_value: string) {
    const shouldFail = nextImageShouldFail;
    queueMicrotask(() => {
      if (shouldFail) this.onerror?.();
      else this.onload?.();
    });
  }
}

interface ControllableClient {
  client: PngToWebpClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: PngToWebpOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  const resolvers = new Map<string, (outcome: PngToWebpOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const client: PngToWebpClient = {
    enqueue: vi.fn((task) => {
      enqueuedIds.push(task.id);
      return new Promise<PngToWebpOutcome>((resolve) => resolvers.set(task.id, resolve));
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

describe("PngToWebpWorkbench", () => {
  let compression: ControllableClient;

  beforeEach(() => {
    compression = createControllableClient();
    vi.mocked(createPngToWebpClient).mockReturnValue(compression.client);

    nextImageShouldFail = false;
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
    vi.stubGlobal("createImageBitmap", vi.fn());
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

  it("PNGを選択すると、非同期チェック後に画質選択・変換ボタンが表示される", async () => {
    render(<PngToWebpWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "WebPへ変換する" })).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "PNG画像を、透過を維持したままWebP形式へ変換します。アニメーションPNGには対応していません。",
      ),
    ).toBeInTheDocument();
  });

  it("JPEGを選択すると「PNG→WebP変換は現在PNGのみに対応しています」と表示され、変換ボタンは出ない", async () => {
    render(<PngToWebpWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() => {
      expect(screen.getByText("PNG→WebP変換は現在PNGのみに対応しています")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "WebPへ変換する" })).not.toBeInTheDocument();
  });

  it("AVIFを選択すると「PNG→WebP変換は現在PNGのみに対応しています」と表示され、AVIF全体のpreflight(file.arrayBuffer)を開始しない", async () => {
    render(<PngToWebpWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    const avifFile = createAvifFile("photo.avif");
    const arrayBufferSpy = vi.spyOn(avifFile, "arrayBuffer");
    selectFiles(input, [avifFile]);

    await waitFor(() => {
      expect(screen.getByText("PNG→WebP変換は現在PNGのみに対応しています")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "WebPへ変換する" })).not.toBeInTheDocument();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("アニメーションPNGを選択すると「アニメーションPNGには現在対応していません。」と表示され、変換ボタンは出ない", async () => {
    render(<PngToWebpWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes({ animated: true }), "anim.png", "image/png")]);

    await waitFor(() => {
      expect(screen.getByText("アニメーションPNGには現在対応していません。")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "WebPへ変換する" })).not.toBeInTheDocument();
  });

  it("変換するを押すと変換が実行され、成功時にWebPを確認/WebPをダウンロードが表示される", async () => {
    render(<PngToWebpWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "WebPへ変換する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "WebPへ変換する" }));

    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    compression.resolve(compression.enqueuedIds[0], {
      status: "done",
      webpBuffer: new ArrayBuffer(4),
      width: 500,
      height: 500,
      quality: 0.8,
      elapsedMs: 100,
    });

    await waitFor(() => {
      expect(screen.getByText("WebPへ変換しました")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "WebPを確認" })).toBeInTheDocument();
  });

  it("個別削除すると変換クライアントのcancelが呼ばれる", async () => {
    render(<PngToWebpWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "WebPへ変換する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "photo.pngを削除" }));

    expect(compression.cancelMock).toHaveBeenCalled();
    expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
  });

  it("すべて削除すると変換クライアントのcancelAllが呼ばれる", async () => {
    render(<PngToWebpWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "WebPへ変換する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));

    expect(compression.cancelAllMock).toHaveBeenCalledTimes(1);
  });

  it("Worker等が非対応の環境では非対応バナーを表示し、変換パネルは表示しない", async () => {
    vi.stubGlobal("Worker", undefined);
    render(<PngToWebpWorkbench locale="ja" />);

    expect(
      screen.getByText("このブラウザはPNG→WebP変換に必要な機能へ対応していません"),
    ).toBeInTheDocument();

    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "WebPへ変換する" })).not.toBeInTheDocument();
  });

  it("画像選択操作やファイル送信フローで外部通信は発生しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sendSpy = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);

    render(<PngToWebpWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "WebPへ変換する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "WebPへ変換する" }));
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  describe("locale=en", () => {
    it("英語文言でレンダーされ、既存の日本語UI文言が残らない", () => {
      const { container } = render(<PngToWebpWorkbench locale="en" />);
      expect(screen.getByText("Select an image, or drag and drop it here")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Converts PNG images to WebP while keeping transparency intact. Animated PNG is not supported.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Your images are processed on this device and are never sent to a server.",
        ),
      ).toBeInTheDocument();

      const text = container.textContent ?? "";
      expect(text).not.toContain("画像を選択、またはここにドラッグ&ドロップ");
      expect(text).not.toContain("透過を維持したままWebP形式へ変換します");
      expect(text).not.toContain("画像はこの端末内で処理され");
    });
  });
});
