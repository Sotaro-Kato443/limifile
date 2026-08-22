import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PngCompressionWorkbench } from "./PngCompressionWorkbench";
import { createPngCompressionClient } from "./png-compression/png-compression-client";
import type { PngCompressionClient } from "./png-compression/png-compression-client";
import type { PngCompressionOutcome as ClientOutcome } from "./png-compression/png-compression-types";

vi.mock("./png-compression/png-compression-client", () => ({
  createPngCompressionClient: vi.fn(),
  detectPngCompressionSupport: vi.fn(() => true),
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

function buildPngBytes(options: { width?: number; height?: number } = {}) {
  const chunks = [pngChunk("IHDR", ihdrData(options.width ?? 500, options.height ?? 500))];
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

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 500;
  naturalHeight = 500;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

interface ControllableClient {
  client: PngCompressionClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: ClientOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  const resolvers = new Map<string, (outcome: ClientOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const client: PngCompressionClient = {
    enqueue: vi.fn((task) => {
      enqueuedIds.push(task.id);
      return new Promise<ClientOutcome>((resolve) => resolvers.set(task.id, resolve));
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

function doneOutcome(overrides: Partial<Extract<ClientOutcome, { status: "done" }>> = {}) {
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

async function submitTarget(presetLabel = "500KB") {
  fireEvent.click(screen.getByRole("button", { name: presetLabel }));
  fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));
}

describe("PngCompressionWorkbench", () => {
  let compression: ControllableClient;

  beforeEach(() => {
    compression = createControllableClient();
    vi.mocked(createPngCompressionClient).mockReturnValue(compression.client);

    vi.stubGlobal("Image", StubImage);
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

  it("PNGを選択すると目標容量入力・圧縮するボタンが表示される", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument();
    });
    expect(screen.getByLabelText("目標容量")).toBeInTheDocument();
  });

  it("JPEGを選択すると「PNG指定容量圧縮は現在PNGのみに対応しています」と表示され、圧縮ボタンは出ない", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() => {
      expect(screen.getByText("PNG指定容量圧縮は現在PNGのみに対応しています")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "圧縮する" })).not.toBeInTheDocument();
  });

  it("AVIFを選択すると「PNG指定容量圧縮は現在PNGのみに対応しています」と表示され、AVIF全体のpreflight(file.arrayBuffer)を開始しない", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    const avifFile = createAvifFile("photo.avif");
    const arrayBufferSpy = vi.spyOn(avifFile, "arrayBuffer");
    selectFiles(input, [avifFile]);

    await waitFor(() => {
      expect(screen.getByText("PNG指定容量圧縮は現在PNGのみに対応しています")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "圧縮する" })).not.toBeInTheDocument();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("圧縮するを押すと圧縮が実行され、成功時(通常)に結果が表示される", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    await submitTarget();

    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));
    compression.resolve(compression.enqueuedIds[0], doneOutcome());

    await waitFor(() => {
      expect(screen.getByText("指定容量以下に圧縮できました")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "PNGをダウンロード" })).toBeInTheDocument();
  });

  it("originalReturned=trueの場合「すでに指定容量以下です」と表示し、色数は表示しない", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    await submitTarget();
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    compression.resolve(
      compression.enqueuedIds[0],
      doneOutcome({ originalReturned: true, colorCount: null, outputBytes: 10000 }),
    );

    await waitFor(() => {
      expect(screen.getByText("すでに指定容量以下です")).toBeInTheDocument();
    });
    expect(screen.getByText("再圧縮せず元のPNGを使用できます。")).toBeInTheDocument();
    expect(screen.queryByText(/使用した色数/)).not.toBeInTheDocument();
  });

  it("unreachable+bestCandidateの場合、未達文言と「PNGをダウンロード」ボタンを表示する", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    await submitTarget();
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    compression.resolve(compression.enqueuedIds[0], {
      status: "unreachable",
      encodeCount: 24,
      bestCandidate: {
        pngBuffer: new ArrayBuffer(4),
        outputBytes: 900_000,
        outputWidth: 500,
        outputHeight: 500,
        colorCount: 2,
      },
    });

    await waitFor(() => {
      expect(screen.getByText("指定容量には到達できませんでした")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "PNGをダウンロード" })).toBeInTheDocument();
    expect(screen.getByText(/WebPへの変換/)).toBeInTheDocument();
  });

  it("unreachableでbestCandidateが無い場合、保存ボタンを表示しない", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    await submitTarget();
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    compression.resolve(compression.enqueuedIds[0], { status: "unreachable", encodeCount: 24 });

    await waitFor(() => {
      expect(screen.getByText("指定容量には到達できませんでした")).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "PNGをダウンロード" })).not.toBeInTheDocument();
    expect(screen.getByText("保存できる候補がありませんでした。")).toBeInTheDocument();
  });

  it.each([
    ["animated-png", "アニメーションPNG(APNG)は現在対応していません。"],
    ["invalid-png", "このファイルを有効なPNG画像として読み込めませんでした。"],
    ["invalid-target", "指定容量を確認してください。"],
    ["unsafe-dimensions", "画像の縦横サイズまたは総ピクセル数が処理上限を超えています。"],
    ["unsupported-png-encoder", "PNGの生成結果を安全に確認できませんでした。"],
    ["timeout", "処理が時間上限を超えました。より小さい画像でお試しください。"],
  ] as const)("Worker結果%sは「%s」と表示される", async (status, message) => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    await submitTarget();
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    compression.resolve(compression.enqueuedIds[0], { status } as ClientOutcome);

    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });
  });

  it("個別削除すると圧縮クライアントのcancelが呼ばれ、一覧から消える", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "photo.pngを削除" }));

    expect(compression.cancelMock).toHaveBeenCalled();
    expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
  });

  it("削除操作1回につき、PNGジョブのcancelは1回だけ呼ばれる(子・親の二重呼び出しが無い)", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    await submitTarget();
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    // startCompression自体も「前回の要求を打ち切る」ため防御的にcancelを呼ぶので、
    // ここまでの既存呼び出し回数をベースラインとして控えておき、削除操作単体による
    // 増分だけを見る(子handleRemoveと親handleRemoveのどちらか一方だけがPNGジョブ削除を
    // 担当していることの回帰確認)。
    const cancelCallsBeforeDelete = compression.cancelMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "photo.pngを削除" }));

    expect(compression.cancelMock.mock.calls.length - cancelCallsBeforeDelete).toBe(1);
  });

  it("すべて削除すると圧縮クライアントのcancelAllが呼ばれる", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));

    expect(compression.cancelAllMock).toHaveBeenCalledTimes(1);
  });

  it("画像選択操作や圧縮フローで外部通信は発生しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sendSpy = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);

    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    await submitTarget();
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("完了後に目標容量を変更すると、古い結果が消えneeds-reprocessの案内が表示される", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
    );
    await submitTarget("500KB");
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));
    compression.resolve(compression.enqueuedIds[0], doneOutcome());

    await waitFor(() => {
      expect(screen.getByText("指定容量以下に圧縮できました")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "1MB" }));

    await waitFor(() => {
      expect(
        screen.getByText("目標容量を変更しました。もう一度「圧縮する」を押してください"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("指定容量以下に圧縮できました")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "PNGをダウンロード" })).not.toBeInTheDocument();
  });

  it("同名ファイルを複数選択しても別項目として扱う", async () => {
    render(<PngCompressionWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [
      createFile(buildPngBytes(), "photo.png", "image/png"),
      createFile(buildPngBytes(), "photo.png", "image/png"),
    ]);

    await waitFor(() => {
      expect(screen.getAllByText("photo.png")).toHaveLength(2);
    });
    expect(screen.getAllByRole("button", { name: "photo.pngを削除" })).toHaveLength(2);
  });

  describe("locale=en", () => {
    it("英語文言でレンダーされ、既存の日本語UI文言が残らない", () => {
      const { container } = render(<PngCompressionWorkbench locale="en" />);
      expect(screen.getByText("Select an image, or drag and drop it here")).toBeInTheDocument();
      expect(
        screen.getByText(
          "PNG stays PNG and is compressed on this device toward your target size. Transparency is supported. Animated PNG (APNG) is not supported.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Your images are processed on this device and are never sent to a server.",
        ),
      ).toBeInTheDocument();

      const text = container.textContent ?? "";
      expect(text).not.toContain("画像を選択、またはここにドラッグ&ドロップ");
      expect(text).not.toContain("画像はこの端末内で処理され");
      expect(text).not.toContain("削除");
    });
  });
});
