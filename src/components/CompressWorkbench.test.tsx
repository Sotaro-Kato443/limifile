import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompressWorkbench } from "./CompressWorkbench";
import { createHeicConversionClient } from "./image-intake/heic-conversion-client";
import { createCompressionClient } from "./image-intake/image-compression-client";
import type {
  HeicConversionClient,
  HeicConvertOutcome,
} from "./image-intake/heic-conversion-client";
import type { CompressionClient, CompressOutcome } from "./image-intake/image-compression-client";

vi.mock("./image-intake/heic-conversion-client", () => ({
  createHeicConversionClient: vi.fn(),
}));
vi.mock("./image-intake/image-compression-client", () => ({
  createCompressionClient: vi.fn(),
}));

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

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
function buildWebpBytes(options: { width?: number; height?: number; animated?: boolean } = {}) {
  const chunk = vp8xChunk(options.width ?? 500, options.height ?? 500, options.animated ?? false);
  return [...riffHeader(chunk.length), ...chunk];
}

const WEBP_BYTES = buildWebpBytes();

function createFile(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** 目標容量(既定500KB)を超えるサイズのJPEGを作り、「既に目標以下」の無変換経路を避ける */
function createLargeJpegFile(name = "photo.jpg", size = 900_000): File {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_BYTES, 0);
  return new File([bytes], name, { type: "image/jpeg" });
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
/** AVIF detection・pre-decode safety自体はavif-isobmff.test.tsで検証済みのため、ここでは
 * 「AVIFとして認識される最小限の有効なbox構造」を1件用意すれば十分(実画像データは不要)。 */
function createAvifFile(name: string): File {
  const ftyp = box("ftyp", [...ascii4("avif"), ...u32be(0), ...ascii4("mif1"), ...ascii4("miaf")]);
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
  naturalWidth = 800;
  naturalHeight = 600;
  set src(_value: string) {
    const shouldFail = nextImageShouldFail;
    queueMicrotask(() => {
      if (shouldFail) this.onerror?.();
      else this.onload?.();
    });
  }
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

interface ControllableCompressionClient {
  client: CompressionClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: CompressOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
}

function createControllableCompressionClient(): ControllableCompressionClient {
  const resolvers = new Map<string, (outcome: CompressOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const client: CompressionClient = {
    enqueue: vi.fn((task) => {
      enqueuedIds.push(task.id);
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

function selectFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

describe("CompressWorkbench", () => {
  let heic: ControllableHeicClient;
  let compression: ControllableCompressionClient;

  beforeEach(() => {
    heic = createControllableHeicClient();
    compression = createControllableCompressionClient();
    vi.mocked(createHeicConversionClient).mockReturnValue(heic.client);
    vi.mocked(createCompressionClient).mockReturnValue(compression.client);

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

  it("JPEGを選択すると目標容量入力(圧縮パネル)が表示される", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() => {
      expect(screen.getByLabelText("目標容量")).toBeInTheDocument();
    });
  });

  it("PNGを選択すると「指定容量圧縮は現在JPEG・HEIC・WebPに対応しています」と表示され、目標容量入力は出ない", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(PNG_BYTES, "photo.png", "image/png")]);

    await waitFor(() => {
      expect(
        screen.getByText("指定容量圧縮は現在JPEG・HEIC・WebPに対応しています"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
  });

  it("静止WebPを選択すると、非同期の安全性チェック後に目標容量入力(圧縮パネル)が表示される", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(WEBP_BYTES, "photo.webp", "image/webp")]);

    await waitFor(() => {
      expect(screen.getByLabelText("目標容量")).toBeInTheDocument();
    });
    expect(
      screen.getByText("WebPは透過を維持したまま、WebP形式で圧縮します。"),
    ).toBeInTheDocument();
  });

  it("アニメーションWebPを選択すると「アニメーションWebPには現在対応していません。」と表示され、目標容量入力は出ない", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(buildWebpBytes({ animated: true }), "anim.webp", "image/webp")]);

    await waitFor(() => {
      expect(screen.getByText("アニメーションWebPには現在対応していません。")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
  });

  it("宣言寸法が安全上限を超えるWebPを選択すると「画像のサイズが大きすぎるため、安全に処理できませんでした。」と表示される", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [
      createFile(buildWebpBytes({ width: 20000, height: 20000 }), "huge.webp", "image/webp"),
    ]);

    await waitFor(() => {
      expect(
        screen.getByText("画像のサイズが大きすぎるため、安全に処理できませんでした。"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
  });

  it("HEIC変換完了後、「HEICはJPGに変換したうえで圧縮します」と表示し、圧縮パネルが使える", async () => {
    render(<CompressWorkbench locale="ja" />);
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
      expect(screen.getByText("HEICはJPGに変換したうえで圧縮します")).toBeInTheDocument();
      expect(screen.getByLabelText("目標容量")).toBeInTheDocument();
    });
  });

  it("AVIFを選択すると「指定容量圧縮は現在JPEG・HEIC・WebPに対応しています」と表示され、AVIF全体のpreflight(file.arrayBuffer)を開始しない", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    const avifFile = createAvifFile("photo.avif");
    const arrayBufferSpy = vi.spyOn(avifFile, "arrayBuffer");
    selectFiles(input, [avifFile]);

    await waitFor(() => {
      expect(
        screen.getByText("指定容量圧縮は現在JPEG・HEIC・WebPに対応しています"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
    // detectImageFormat自体は先頭の一部だけをslice(0, N).arrayBuffer()で読むため、
    // File.prototype.arrayBuffer(引数無し=ファイル全体)が一度も呼ばれていないことを確認する
    // (AVIFのispe検証・実デコードに向けたfull-file preflightが一切開始されていないことの証跡)。
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("圧縮するを押すと圧縮が実行され、成功時にJPGを確認/JPGを保存が表示される", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createLargeJpegFile("photo.jpg")]);

    await waitFor(() => expect(screen.getByLabelText("目標容量")).toBeInTheDocument());

    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    compression.resolve(compression.enqueuedIds[0], {
      status: "done",
      jpegBuffer: new ArrayBuffer(4),
      width: 1000,
      height: 800,
      quality: 0.6,
      encodeCount: 4,
      resizeCount: 0,
      elapsedMs: 500,
    });

    await waitFor(() => {
      expect(screen.getByText("圧縮が完了しました")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "JPGを確認" })).toBeInTheDocument();
  });

  it("個別削除すると圧縮クライアントのcancelが呼ばれる", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() => expect(screen.getByLabelText("目標容量")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "photo.jpgを削除" }));

    expect(compression.cancelMock).toHaveBeenCalled();
    expect(screen.queryByText("photo.jpg")).not.toBeInTheDocument();
  });

  it("すべて削除すると圧縮クライアントのcancelAllが呼ばれる", async () => {
    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() => expect(screen.getByLabelText("目標容量")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));

    expect(compression.cancelAllMock).toHaveBeenCalledTimes(1);
  });

  it("Worker等が非対応の環境では非対応バナーを表示し、圧縮パネルは表示しない", async () => {
    vi.stubGlobal("Worker", undefined);
    render(<CompressWorkbench locale="ja" />);

    expect(
      screen.getByText("このブラウザは画像圧縮に必要な機能へ対応していません"),
    ).toBeInTheDocument();

    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeInTheDocument());
    expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
  });

  it("/compress-image-to-500kb相当のdefaultTargetValue/defaultTargetUnitが初期値に反映される", async () => {
    render(<CompressWorkbench locale="ja" defaultTargetValue={500} defaultTargetUnit="KB" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createLargeJpegFile("photo.jpg")]);

    await waitFor(() => expect(screen.getByLabelText("目標容量")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));
    expect(compression.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ targetBytes: 500_000 }),
      expect.anything(),
    );
  });

  it("画像選択操作やファイル送信フローで外部通信は発生しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sendSpy = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);

    render(<CompressWorkbench locale="ja" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    selectFiles(input, [createLargeJpegFile("photo.jpg")]);

    await waitFor(() => expect(screen.getByLabelText("目標容量")).toBeInTheDocument());
    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));
    await waitFor(() => expect(compression.enqueuedIds).toHaveLength(1));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  describe("locale=en", () => {
    it("英語文言でレンダーされ、既存の日本語UI文言が残らない", () => {
      const { container } = render(<CompressWorkbench locale="en" />);
      expect(screen.getByText("Select an image, or drag and drop it here")).toBeInTheDocument();
      expect(
        screen.getByText(
          "WebP is compressed to WebP, keeping transparency intact. Animated WebP is not supported.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Your images are processed on this device and are never sent to a server.",
        ),
      ).toBeInTheDocument();

      const text = container.textContent ?? "";
      expect(text).not.toContain("画像を選択、またはここにドラッグ&ドロップ");
      expect(text).not.toContain("透過を維持したまま、WebP形式で圧縮します");
      expect(text).not.toContain("画像はこの端末内で処理され");
    });
  });
});
