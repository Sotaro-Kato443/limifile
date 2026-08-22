import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixedTargetCompressionWorkbench } from "./FixedTargetCompressionWorkbench";
import { toCompressionTarget } from "./image-intake/compression-target";
import { createHeicConversionClient } from "./image-intake/heic-conversion-client";
import { createCompressionClient } from "./image-intake/image-compression-client";
import { createPngCompressionClient } from "./png-compression/png-compression-client";
import type {
  HeicConversionClient,
  HeicConvertOutcome,
} from "./image-intake/heic-conversion-client";
import type { CompressionClient, CompressOutcome } from "./image-intake/image-compression-client";
import type { PngCompressionClient } from "./png-compression/png-compression-client";
import type { PngCompressionOutcome } from "./png-compression/png-compression-types";

vi.mock("./image-intake/heic-conversion-client", () => ({
  createHeicConversionClient: vi.fn(),
}));
vi.mock("./image-intake/image-compression-client", () => ({
  createCompressionClient: vi.fn(),
}));
vi.mock("./png-compression/png-compression-client", () => ({
  createPngCompressionClient: vi.fn(),
  detectPngCompressionSupport: vi.fn(() => true),
}));

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}
function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
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
/**
 * 500KBを超える有効なWebPを組み立てる。単純にゼロバイトでパディングするとRIFF全体サイズと
 * 実際のバッファ長が食い違い、readWebpChunksがmalformed判定してしまうため、VP8Xの後ろに
 * 未知チャンク(JUNK)を追加してRIFF宣言サイズと実サイズを一致させる。
 */
function buildLargeWebpBytes(targetSize = 900_000, options: { animated?: boolean } = {}) {
  const vp8x = vp8xChunk(500, 500, options.animated ?? false);
  const headerLen = 12 + vp8x.length;
  const paddingChunkOverhead = 8;
  let paddingDataLen = Math.max(0, targetSize - headerLen - paddingChunkOverhead);
  if (paddingDataLen % 2 !== 0) paddingDataLen += 1;
  const paddingChunk = [
    ...ascii("JUNK"),
    ...u32le(paddingDataLen),
    ...new Array(paddingDataLen).fill(0),
  ];
  const payload = [...vp8x, ...paddingChunk];
  return [...riffHeader(payload.length), ...payload];
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
  return new File([buildFtypBytes("heic", ["mif1", "heix", "hevc"])], name, {
    type: "image/heic",
  });
}

function box(type: string, payload: number[]): number[] {
  return [...u32be(8 + payload.length), ...ascii(type), ...payload];
}
/** AVIF detection・pre-decode safety自体はavif-isobmff.test.tsで検証済みのため、ここでは
 * 「AVIFとして認識される最小限の有効なbox構造」を1件用意すれば十分(実画像データは不要)。 */
function createAvifFile(name: string): File {
  const ftyp = box("ftyp", [...ascii("avif"), ...u32be(0), ...ascii("mif1"), ...ascii("miaf")]);
  const ispe = box("ispe", [...u32be(0), ...u32be(500), ...u32be(500)]);
  const ipco = box("ipco", ispe);
  const iprp = box("iprp", ipco);
  const meta = box("meta", [...u32be(0), ...iprp]);
  return new File([new Uint8Array([...ftyp, ...meta])], name, { type: "image/avif" });
}

function createFile(bytes: number[] | Uint8Array, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** 目標容量(500KB)を超えるサイズのJPEGを作り、既に目標以下の無変換経路(client未経由)を避ける */
function createLargeJpegFile(name = "photo.jpg", size = 900_000): File {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_BYTES, 0);
  return new File([bytes], name, { type: "image/jpeg" });
}
function createLargeWebpFile(name = "photo.webp", size = 900_000): File {
  return new File([new Uint8Array(buildLargeWebpBytes(size))], name, { type: "image/webp" });
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
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
  destroyMock: ReturnType<typeof vi.fn>;
}
function createControllableCompressionClient(order: string[]): ControllableCompressionClient {
  const resolvers = new Map<string, (outcome: CompressOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const destroyMock = vi.fn();
  const client: CompressionClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      order.push(`jpeg-webp:${task.id}`);
      callbacks?.onStart?.();
      return new Promise<CompressOutcome>((resolve) => resolvers.set(task.id, resolve));
    }),
    cancel: cancelMock,
    cancelAll: cancelAllMock,
    destroy: destroyMock,
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
    destroyMock,
  };
}

interface ControllablePngClient {
  client: PngCompressionClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: PngCompressionOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
  destroyMock: ReturnType<typeof vi.fn>;
}
function createControllablePngClient(order: string[]): ControllablePngClient {
  const resolvers = new Map<string, (outcome: PngCompressionOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const destroyMock = vi.fn();
  const client: PngCompressionClient = {
    enqueue: vi.fn((task, callbacks) => {
      enqueuedIds.push(task.id);
      order.push(`png:${task.id}`);
      callbacks?.onStart?.();
      return new Promise<PngCompressionOutcome>((resolve) => resolvers.set(task.id, resolve));
    }),
    cancel: cancelMock,
    cancelAll: cancelAllMock,
    destroy: destroyMock,
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
    destroyMock,
  };
}

function doneJpegOutcome(overrides: Partial<Extract<CompressOutcome, { status: "done" }>> = {}) {
  return {
    status: "done" as const,
    jpegBuffer: new ArrayBuffer(4),
    width: 1000,
    height: 800,
    quality: 0.6,
    encodeCount: 4,
    resizeCount: 0,
    elapsedMs: 500,
    ...overrides,
  };
}
function donePngOutcome(
  overrides: Partial<Extract<PngCompressionOutcome, { status: "done" }>> = {},
) {
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

async function submitCompress() {
  fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));
}
async function submitAllCompress() {
  for (const button of screen.getAllByRole("button", { name: "圧縮する" })) {
    fireEvent.click(button);
  }
}

const FIXED_TARGET_500KB = toCompressionTarget(500, "KB");

describe("FixedTargetCompressionWorkbench (target=500KB, existing regression)", () => {
  let order: string[];
  let heic: ControllableHeicClient;
  let jpegWebp: ControllableCompressionClient;
  let png: ControllablePngClient;

  beforeEach(() => {
    order = [];
    heic = createControllableHeicClient();
    jpegWebp = createControllableCompressionClient(order);
    png = createControllablePngClient(order);
    vi.mocked(createHeicConversionClient).mockReturnValue(heic.client);
    vi.mocked(createCompressionClient).mockReturnValue(jpegWebp.client);
    vi.mocked(createPngCompressionClient).mockReturnValue(png.client);

    nextImageShouldFail = false;
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
    vi.stubGlobal("ImageData", class {});
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

  describe("ページ・入力", () => {
    it("PNGを選択すると圧縮する導線が表示される(目標容量入力は出ない)", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument();
      });
      expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
    });

    it("JPEGを選択すると圧縮する導線が表示される(目標容量入力欄は出ない、500KB固定)", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile()]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument();
      });
      expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("WebPを選択すると非同期チェック後に圧縮導線が表示される(目標容量入力欄は出ない)", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeWebpFile()]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
    });

    it("アニメーションWebPは対象外と表示される", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildWebpBytes({ animated: true }), "anim.webp", "image/webp"),
      ]);

      await waitFor(() => {
        expect(
          screen.getByText("アニメーションWebPには現在対応していません。"),
        ).toBeInTheDocument();
      });
    });

    it("壊れたPNG(APNG)はWorker応答後にエラー表示される", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "anim.png", "image/png")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      png.resolve(png.enqueuedIds[0], { status: "animated-png" });

      await waitFor(() => {
        expect(
          screen.getByText("アニメーションPNG(APNG)は現在対応していません。"),
        ).toBeInTheDocument();
      });
    });

    it("50MiB超のPNGはarrayBufferを呼ばず明確なエラーを表示し、他ファイルの処理は継続する", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      const hugeBytes = new Uint8Array(50 * 1024 * 1024 + 1);
      hugeBytes.set(PNG_SIGNATURE, 0);
      const hugeFile = new File([hugeBytes], "huge.png", { type: "image/png" });
      const arrayBufferSpy = vi.spyOn(hugeFile, "arrayBuffer");

      selectFiles(input, [hugeFile, createFile(buildPngBytes(), "small.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      fireEvent.click(screen.getAllByRole("button", { name: "圧縮する" })[0]);

      await waitFor(() => {
        expect(
          screen.getByText("ファイルのサイズが大きすぎるため処理できません(上限50MB)。"),
        ).toBeInTheDocument();
      });
      expect(arrayBufferSpy).not.toHaveBeenCalled();
      expect(png.enqueuedIds).toHaveLength(0);

      fireEvent.click(screen.getAllByRole("button", { name: "圧縮する" })[1]);
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
    });

    it("同名ファイルを複数選択しても別項目として扱う", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildPngBytes(), "photo.png", "image/png"),
        createFile(buildPngBytes(), "photo.png", "image/png"),
      ]);

      await waitFor(() => {
        expect(screen.getAllByText("photo.png")).toHaveLength(2);
      });
    });

    it("AVIFを選択すると「この形式は{容量}圧縮の対象外です」と表示され、AVIF全体のpreflight(file.arrayBuffer)を開始しない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      const avifFile = createAvifFile("photo.avif");
      const arrayBufferSpy = vi.spyOn(avifFile, "arrayBuffer");
      selectFiles(input, [avifFile]);

      await waitFor(() => {
        expect(screen.getByText(/圧縮の対象外です/)).toBeInTheDocument();
      });
      expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "圧縮する" })).not.toBeInTheDocument();
      // detectImageFormat自体は先頭の一部だけをslice(0, N).arrayBuffer()で読むため、
      // File.prototype.arrayBuffer(引数無し=ファイル全体)が一度も呼ばれていないことを確認する。
      expect(arrayBufferSpy).not.toHaveBeenCalled();
    });

    it("HEIC変換完了後、JPGとして圧縮できる", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
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
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument();
      });
      expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
    });
  });

  describe("PNG結果表示", () => {
    async function selectAndCompressPng(fileName = "photo.png") {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), fileName, "image/png")]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
    }

    it("done: 指定容量以下に圧縮できたことと保存導線を表示する", async () => {
      await selectAndCompressPng();
      png.resolve(png.enqueuedIds[0], donePngOutcome());

      await waitFor(() => {
        expect(screen.getByText("指定容量以下に圧縮できました")).toBeInTheDocument();
      });
      expect(screen.getByRole("link", { name: "PNGをダウンロード" })).toBeInTheDocument();
      expect(screen.getByText("元容量: 10 KB")).toBeInTheDocument();
    });

    it("originalReturned: 既に500KB以下である旨を表示し、色数は表示しない", async () => {
      await selectAndCompressPng();
      png.resolve(
        png.enqueuedIds[0],
        donePngOutcome({ originalReturned: true, colorCount: null, outputBytes: 10000 }),
      );

      await waitFor(() => {
        expect(screen.getByText("すでに指定容量以下です")).toBeInTheDocument();
      });
      expect(screen.getByText("再圧縮せず元のPNGを使用できます。")).toBeInTheDocument();
      expect(screen.queryByText(/使用した色数/)).not.toBeInTheDocument();
    });

    it("resized: 出力寸法が元寸法と異なる場合、寸法縮小を明示する", async () => {
      await selectAndCompressPng();
      png.resolve(png.enqueuedIds[0], donePngOutcome({ outputWidth: 250, outputHeight: 250 }));

      await waitFor(() => {
        expect(screen.getByText(/自動的に寸法を縮小しました/)).toBeInTheDocument();
      });
    });

    it("unreachable + bestCandidate: 未達文言と保存導線(success色ではない)を表示する", async () => {
      await selectAndCompressPng();
      png.resolve(png.enqueuedIds[0], {
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
      expect(screen.getByText(/目標容量.*を超えています/)).toBeInTheDocument();
      expect(document.querySelector(".png-compression-result--success")).not.toBeInTheDocument();
    });

    it("unreachable without bestCandidate: 保存ボタンを表示しない", async () => {
      await selectAndCompressPng();
      png.resolve(png.enqueuedIds[0], { status: "unreachable", encodeCount: 24 });

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
      ["error", "画像処理を開始できませんでした。もう一度お試しください。"],
    ] as const)("PNGエラー%sは「%s」と表示される", async (status, message) => {
      await selectAndCompressPng();
      png.resolve(png.enqueuedIds[0], { status, message: "内部エラー" } as PngCompressionOutcome);

      await waitFor(() => {
        expect(screen.getByText(message)).toBeInTheDocument();
      });
    });

    it("cancelled: キャンセルしましたと表示される", async () => {
      await selectAndCompressPng();
      fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

      await waitFor(() => {
        expect(screen.getByText("キャンセルしました")).toBeInTheDocument();
      });
    });
  });

  describe("JPEG/WebP回帰", () => {
    it("JPEG: 圧縮するを押すと圧縮が実行され、成功時にJPGを確認/ダウンロードが表示される", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile("photo.jpg")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      expect(jpegWebp.client.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ targetBytes: 500_000 }),
        expect.anything(),
      );
      jpegWebp.resolve(jpegWebp.enqueuedIds[0], doneJpegOutcome());

      await waitFor(() => {
        expect(screen.getByText("圧縮が完了しました")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "JPGを確認" })).toBeInTheDocument();
    });

    it("JPEG: 500KB以下のファイルは即座に「すでに目標容量以下です」と表示される(client未経由)", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(JPEG_BYTES, "small.jpg", "image/jpeg")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();

      await waitFor(() => {
        expect(screen.getByText("すでに目標容量以下です")).toBeInTheDocument();
      });
      expect(jpegWebp.enqueuedIds).toHaveLength(0);
    });

    it("WebP: 透明WebPを圧縮できる", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeWebpFile("photo.webp")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      jpegWebp.resolve(jpegWebp.enqueuedIds[0], {
        status: "webp-done",
        webpBuffer: new ArrayBuffer(4),
        width: 500,
        height: 500,
        quality: 0.7,
        encodeCount: 3,
        resizeCount: 0,
        elapsedMs: 300,
      });

      await waitFor(() => {
        expect(screen.getByText("圧縮が完了しました")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "WebPを確認" })).toBeInTheDocument();
    });

    it("壊れたJPEG/WebPはdecode-failed文言を表示する", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile("broken.jpg")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      jpegWebp.resolve(jpegWebp.enqueuedIds[0], { status: "malformed-webp" });

      await waitFor(() => {
        expect(
          screen.getByText("画像を読み込めませんでした。別のファイルでお試しください。"),
        ).toBeInTheDocument();
      });
    });

    it("timeout相当(unreachable)は未達文言を表示する", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile()]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      jpegWebp.resolve(jpegWebp.enqueuedIds[0], {
        status: "unreachable",
        encodeCount: 12,
        resizeCount: 3,
        elapsedMs: 900,
      });

      await waitFor(() => {
        expect(
          screen.getByText("この画像は現在の最低画質・最小寸法では指定容量以下にできませんでした"),
        ).toBeInTheDocument();
      });
    });

    it("複数のJPEGファイルを個別に扱える", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile("a.jpg"), createLargeJpegFile("b.jpg")]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
    });
  });

  describe("全形式共通FIFO", () => {
    it("JPEG→PNG→WebPの順で開始すると、直列に1件ずつ処理される", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createLargeJpegFile("a.jpg"),
        createFile(buildPngBytes(), "b.png", "image/png"),
        createLargeWebpFile("c.webp"),
      ]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(3);
      });
      await submitAllCompress();

      // Aのみdispatchされ、B・Cはまだ待機中
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      expect(png.enqueuedIds).toHaveLength(0);
      expect(screen.getAllByText("圧縮待ち…")).toHaveLength(2);

      jpegWebp.resolve(jpegWebp.enqueuedIds[0], doneJpegOutcome());
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      expect(jpegWebp.enqueuedIds).toHaveLength(1); // Cはまだ

      png.resolve(png.enqueuedIds[0], donePngOutcome());
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(2));

      jpegWebp.resolve(jpegWebp.enqueuedIds[1], doneJpegOutcome());
      await waitFor(() => {
        expect(screen.getAllByText("圧縮が完了しました")).toHaveLength(2);
        expect(screen.getByText("指定容量以下に圧縮できました")).toBeInTheDocument();
      });

      expect(order).toEqual([
        `jpeg-webp:${jpegWebp.enqueuedIds[0]}`,
        `png:${png.enqueuedIds[0]}`,
        `jpeg-webp:${jpegWebp.enqueuedIds[1]}`,
      ]);
    });

    it("PNG→JPEG→PNGの順で開始しても、開始順どおりに直列処理される(arrayBuffer解決順に依存しない)", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildPngBytes(), "a.png", "image/png"),
        createLargeJpegFile("b.jpg"),
        createFile(buildPngBytes(), "c.png", "image/png"),
      ]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(3);
      });
      await submitAllCompress();

      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      expect(jpegWebp.enqueuedIds).toHaveLength(0);

      const firstPngId = png.enqueuedIds[0];
      png.resolve(firstPngId, donePngOutcome());
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      expect(png.enqueuedIds).toHaveLength(1); // 2件目のPNGはまだ

      jpegWebp.resolve(jpegWebp.enqueuedIds[0], doneJpegOutcome());
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(2));

      png.resolve(png.enqueuedIds[1], donePngOutcome());
      await waitFor(() => {
        expect(screen.getAllByText("指定容量以下に圧縮できました")).toHaveLength(2);
      });

      expect(order).toEqual([
        `png:${png.enqueuedIds[0]}`,
        `jpeg-webp:${jpegWebp.enqueuedIds[0]}`,
        `png:${png.enqueuedIds[1]}`,
      ]);
    });

    it("同時にactiveなジョブは常に1件までである", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createLargeJpegFile("a.jpg"),
        createFile(buildPngBytes(), "b.png", "image/png"),
      ]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();

      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      expect(png.enqueuedIds).toHaveLength(0);
      // JPEGが未解決のうちはPNGはenqueueされない
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(png.enqueuedIds).toHaveLength(0);
    });

    it("PNG timeout後にJPEGが処理される", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildPngBytes(), "a.png", "image/png"),
        createLargeJpegFile("b.jpg"),
      ]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();

      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      png.resolve(png.enqueuedIds[0], { status: "timeout" });

      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
    });

    it("JPEG error後にPNGが処理される", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createLargeJpegFile("a.jpg"),
        createFile(buildPngBytes(), "b.png", "image/png"),
      ]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();

      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      jpegWebp.resolve(jpegWebp.enqueuedIds[0], { status: "error", message: "内部エラー" });

      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
    });

    it("実行中のPNGを削除するとcancelされ、次のWebPが処理される", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildPngBytes(), "a.png", "image/png"),
        createLargeWebpFile("b.webp"),
      ]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();

      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      fireEvent.click(screen.getByRole("button", { name: "a.pngを削除" }));

      expect(png.cancelMock).toHaveBeenCalled();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
    });

    it("待機中のJPEGを削除しても、実行中のPNGには影響しない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildPngBytes(), "a.png", "image/png"),
        createLargeJpegFile("b.jpg"),
      ]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();

      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      fireEvent.click(screen.getByRole("button", { name: "b.jpgを削除" }));

      expect(screen.queryByText("b.jpg")).not.toBeInTheDocument();
      png.resolve(png.enqueuedIds[0], donePngOutcome());
      await waitFor(() => {
        expect(screen.getByText("指定容量以下に圧縮できました")).toBeInTheDocument();
      });
      expect(jpegWebp.enqueuedIds).toHaveLength(0);
    });

    it("すべて削除すると、両クライアントのcancelAllが呼ばれる", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createLargeJpegFile("a.jpg"),
        createFile(buildPngBytes(), "b.png", "image/png"),
      ]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));

      fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));

      expect(jpegWebp.cancelAllMock).toHaveBeenCalledTimes(1);
      expect(png.cancelAllMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("a.jpg")).not.toBeInTheDocument();
      expect(screen.queryByText("b.png")).not.toBeInTheDocument();
    });

    it("unmountで両クライアントのdestroyが呼ばれる", async () => {
      const { unmount } = render(
        <FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />,
      );
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile("a.jpg")]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );

      unmount();

      expect(jpegWebp.destroyMock).toHaveBeenCalled();
      expect(png.destroyMock).toHaveBeenCalled();
    });

    it("staleなJPEG結果(削除後に届く)は無視され、エラーにならない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile("a.jpg")]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));

      fireEvent.click(screen.getByRole("button", { name: "a.jpgを削除" }));
      expect(screen.queryByText("a.jpg")).not.toBeInTheDocument();

      expect(() => {
        jpegWebp.resolve(jpegWebp.enqueuedIds[0], doneJpegOutcome());
      }).not.toThrow();
      expect(screen.queryByText("圧縮が完了しました")).not.toBeInTheDocument();
    });

    it("staleなPNG結果(削除後に届く)は無視され、エラーにならない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "a.png", "image/png")]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));

      fireEvent.click(screen.getByRole("button", { name: "a.pngを削除" }));
      expect(screen.queryByText("a.png")).not.toBeInTheDocument();

      expect(() => {
        png.resolve(png.enqueuedIds[0], donePngOutcome());
      }).not.toThrow();
      expect(screen.queryByText("指定容量以下に圧縮できました")).not.toBeInTheDocument();
    });

    it("同一アイテムを再処理すると、前回のジョブを打ち切り新しいジョブが実行される(常に500,000 bytes)", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile("a.jpg")]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      jpegWebp.resolve(jpegWebp.enqueuedIds[0], doneJpegOutcome());
      await waitFor(() => expect(screen.getByText("圧縮が完了しました")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(2));
      expect(jpegWebp.client.enqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ targetBytes: 500_000 }),
        expect.anything(),
      );
      jpegWebp.resolve(jpegWebp.enqueuedIds[1], doneJpegOutcome());
      await waitFor(() => {
        expect(screen.getByText("圧縮が完了しました")).toBeInTheDocument();
      });
    });
  });

  describe("500KB共通FIFO: JPEG arrayBuffer読み込み中の競合", () => {
    /** 指定ファイルのarrayBuffer()の解決タイミングをテストコードから制御する */
    function withControllableArrayBuffer(file: File) {
      let resolveFn: (buffer: ArrayBuffer) => void = () => {};
      let rejectFn: (error: unknown) => void = () => {};
      vi.spyOn(file, "arrayBuffer").mockImplementation(
        () =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = reject;
          }),
      );
      return {
        resolve: (buffer: ArrayBuffer = new ArrayBuffer(4)) => resolveFn(buffer),
        reject: (error: unknown) => rejectFn(error),
      };
    }

    // arrayBuffer待機中(client未経由)のJPEGはCompressPanelが「queued」表示のみでキャンセル
    // ボタンを持たない(processing状態でのみキャンセルボタンを出す既存仕様、
    // src/components/image-intake/compress-panel.tsx参照)。そのためDOM上からの
    // cancel操作はこの状態では発生し得ず、cancelCompression自体の競合対策は
    // use-image-compression.test.tsx・use-500kb-compression-orchestrator.test.tsで
    // hookレベルで厳密に検証する。ここではDOM上から常に到達可能な「削除」経路のみ検証する。
    it("実行中JPEGをarrayBuffer待機中に削除すると、PNGへ進み、旧JPEGは後からenqueueされない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      const jpegFile = createLargeJpegFile("a.jpg");
      const buffer = withControllableArrayBuffer(jpegFile);
      selectFiles(input, [jpegFile, createFile(buildPngBytes(), "b.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();
      expect(jpegWebp.enqueuedIds).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: "a.jpgを削除" }));
      expect(screen.queryByText("a.jpg")).not.toBeInTheDocument();

      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));

      buffer.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(jpegWebp.enqueuedIds).toHaveLength(0);
      // AとBが同時にprocessingになっていない(PNGのみがactive)
      expect(jpegWebp.client.enqueue).not.toHaveBeenCalled();
    });

    it("実行中JPEGのarrayBufferがrejectすると、そのアイテムはerrorになり、次のPNGへ進む", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      const jpegFile = createLargeJpegFile("a.jpg");
      const buffer = withControllableArrayBuffer(jpegFile);
      selectFiles(input, [jpegFile, createFile(buildPngBytes(), "b.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();

      buffer.reject(new Error("read failed"));

      await waitFor(() => {
        expect(
          screen.getByText("画像処理を開始できませんでした。もう一度お試しください。"),
        ).toBeInTheDocument();
      });
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
    });

    it("JPEG読み込み中にすべて削除すると、旧JPEG・PNGいずれも後から復活しない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      const jpegFile = createLargeJpegFile("a.jpg");
      const buffer = withControllableArrayBuffer(jpegFile);
      selectFiles(input, [jpegFile, createFile(buildPngBytes(), "b.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();

      fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));
      expect(screen.queryByText("a.jpg")).not.toBeInTheDocument();
      expect(screen.queryByText("b.png")).not.toBeInTheDocument();

      buffer.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(jpegWebp.enqueuedIds).toHaveLength(0);
      expect(png.enqueuedIds).toHaveLength(0);
    });
  });

  describe("固定target(500,000 bytes)", () => {
    it("100KB等へ変更できる入力UIはどの形式にも存在しない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createLargeJpegFile("a.jpg"),
        createFile(buildPngBytes(), "b.png", "image/png"),
        createLargeWebpFile("c.webp"),
      ]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(3);
      });
      expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
      expect(screen.queryByText("100KB")).not.toBeInTheDocument();
      expect(screen.queryByText("200KB")).not.toBeInTheDocument();
      expect(screen.queryByText("1MB")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("JPEG/WebP/PNGいずれも常に500,000 bytesでenqueueされる", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createLargeJpegFile("a.jpg"),
        createFile(buildPngBytes(), "b.png", "image/png"),
        createLargeWebpFile("c.webp"),
      ]);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(3);
      });
      await submitAllCompress();

      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      expect(jpegWebp.client.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ targetBytes: 500_000 }),
        expect.anything(),
      );
      jpegWebp.resolve(jpegWebp.enqueuedIds[0], doneJpegOutcome());

      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      expect(png.client.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ targetBytes: 500_000 }),
        expect.anything(),
      );
      png.resolve(png.enqueuedIds[0], donePngOutcome());

      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(2));
      expect(jpegWebp.client.enqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ targetBytes: 500_000 }),
        expect.anything(),
      );
    });
  });

  describe("保存・外部送信なし", () => {
    it("PNG保存ファイル名はexample-compressed.pngになる", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "example.png", "image/png")]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      png.resolve(png.enqueuedIds[0], donePngOutcome());

      await waitFor(() => {
        expect(screen.getByRole("link", { name: "PNGをダウンロード" })).toHaveAttribute(
          "download",
          "example-compressed.png",
        );
      });
    });

    it("unreachable+bestCandidateの保存ファイル名はexample-minimized.pngになる", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "example.png", "image/png")]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      png.resolve(png.enqueuedIds[0], {
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
        expect(screen.getByRole("link", { name: "PNGをダウンロード" })).toHaveAttribute(
          "download",
          "example-minimized.png",
        );
      });
    });

    it("画像選択・圧縮フローでJPEG/PNG/WebPいずれもfetch/XHRへ送信されない", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const sendSpy = vi
        .spyOn(XMLHttpRequest.prototype, "send")
        .mockImplementation(() => undefined);

      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createLargeJpegFile("a.jpg"),
        createFile(buildPngBytes(), "b.png", "image/png"),
        createLargeWebpFile("c.webp"),
      ]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(3);
      });
      await submitAllCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe("removeJob二重呼び出し回帰", () => {
    it("PNGアイテムの削除操作1回につき、下位クライアントのcancelは1回分しか増えない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));

      // startCompression自体も「前回の要求を打ち切る」ため防御的にcancelを呼ぶので、
      // ここまでの既存呼び出し回数をベースラインとして控えておき、削除操作単体による
      // 増分だけを見る(子・親のどちらか一方だけがremoveJobを担当していることの回帰確認)。
      const cancelCallsBeforeDelete = png.cancelMock.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "photo.pngを削除" }));

      expect(png.cancelMock.mock.calls.length - cancelCallsBeforeDelete).toBe(1);
      expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    });

    it("JPEGアイテムの削除操作1回につき、下位クライアントのcancelは1回分しか増えない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile("photo.jpg")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));

      const cancelCallsBeforeDelete = jpegWebp.cancelMock.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "photo.jpgを削除" }));

      expect(jpegWebp.cancelMock.mock.calls.length - cancelCallsBeforeDelete).toBe(1);
      expect(screen.queryByText("photo.jpg")).not.toBeInTheDocument();
    });

    it("待機中(未dispatch)のアイテムを削除しても、削除操作1回につきcancelは高々1回で、実行中アイテムには影響しない", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createLargeJpegFile("a.jpg"),
        createFile(buildPngBytes(), "b.png", "image/png"),
      ]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));

      // b.pngはまだdispatchされていない(待機中)ため、下位PNGクライアントへのcancel呼び出しは
      // 高々1回(idempotentな安全弁としての呼び出し)に留まり、二重呼び出しは起きない。
      const pngCancelCallsBefore = png.cancelMock.mock.calls.length;
      const jpegCancelCallsBefore = jpegWebp.cancelMock.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "b.pngを削除" }));

      expect(png.cancelMock.mock.calls.length - pngCancelCallsBefore).toBeLessThanOrEqual(1);
      expect(screen.queryByText("b.png")).not.toBeInTheDocument();
      // 実行中だったa.jpgには影響しない
      expect(screen.getByText("a.jpg")).toBeInTheDocument();
      expect(jpegWebp.cancelMock.mock.calls.length).toBe(jpegCancelCallsBefore);
    });

    it("完了後(結果表示済み)のアイテムを削除しても、一覧から1件だけ消える", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createLargeJpegFile("a.jpg"), createLargeJpegFile("b.jpg")]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "圧縮する" })).toHaveLength(2);
      });
      await submitAllCompress();
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
      jpegWebp.resolve(jpegWebp.enqueuedIds[0], doneJpegOutcome());
      await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(2));
      jpegWebp.resolve(jpegWebp.enqueuedIds[1], doneJpegOutcome());
      await waitFor(() => {
        expect(screen.getAllByText("圧縮が完了しました")).toHaveLength(2);
      });

      fireEvent.click(screen.getByRole("button", { name: "a.jpgを削除" }));

      expect(screen.queryByText("a.jpg")).not.toBeInTheDocument();
      expect(screen.getByText("b.jpg")).toBeInTheDocument();
    });
  });

  describe("アクセシビリティ", () => {
    it("削除ボタンはファイル名を含むaccessible nameを持つ", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "photo.pngを削除" })).toBeInTheDocument();
      });
    });

    it("PNGエラーはrole=alertで通知される", async () => {
      render(<FixedTargetCompressionWorkbench locale="ja" target={FIXED_TARGET_500KB} />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "a.png", "image/png")]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument(),
      );
      await submitCompress();
      await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
      png.resolve(png.enqueuedIds[0], { status: "invalid-png" });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "このファイルを有効なPNG画像として読み込めませんでした。",
        );
      });
    });
  });

  describe("locale=en", () => {
    it("英語文言でレンダーされ、既存の日本語UI文言が残らない", () => {
      const { container } = render(
        <FixedTargetCompressionWorkbench locale="en" target={FIXED_TARGET_500KB} />,
      );
      expect(screen.getByText("Select an image, or drag and drop it here")).toBeInTheDocument();
      expect(
        screen.getByText(
          "WebP is compressed to WebP, keeping transparency intact. Animated WebP is not supported. PNG stays PNG and is never auto-converted to WebP. Animated PNG (APNG) is not supported.",
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

describe("FixedTargetCompressionWorkbench — targetは呼び出し側が任意に指定できる(500KB専用ではない)", () => {
  let heic: ControllableHeicClient;
  let jpegWebp: ControllableCompressionClient;
  let png: ControllablePngClient;

  beforeEach(() => {
    heic = createControllableHeicClient();
    jpegWebp = createControllableCompressionClient([]);
    png = createControllablePngClient([]);
    vi.mocked(createHeicConversionClient).mockReturnValue(heic.client);
    vi.mocked(createCompressionClient).mockReturnValue(jpegWebp.client);
    vi.mocked(createPngCompressionClient).mockReturnValue(png.client);

    nextImageShouldFail = false;
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
    vi.stubGlobal("ImageData", class {});
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

  it.each([
    [20, 20_000],
    [50, 50_000],
    [100, 100_000],
    [200, 200_000],
  ] as const)("target=%sKBのとき、JPEGはtargetBytes=%sでenqueueされる", async (kb, bytes) => {
    const target = toCompressionTarget(kb, "KB");
    render(<FixedTargetCompressionWorkbench locale="en" target={target} />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createLargeJpegFile("photo.jpg")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Compress" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    await waitFor(() => expect(jpegWebp.enqueuedIds).toHaveLength(1));
    expect(jpegWebp.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ targetBytes: bytes }),
      expect.anything(),
    );
  });

  it("target=20KBのとき、非対応形式メッセージに「20KB」が表示される(500KB固定文言の回帰)", async () => {
    const target = toCompressionTarget(20, "KB");
    render(<FixedTargetCompressionWorkbench locale="en" target={target} />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() => {
      expect(screen.getByText(/reach 20KB/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/reach 500KB/)).not.toBeInTheDocument();
  });

  it("target=100KBのとき、PNGはtargetBytes=100,000でenqueueされる", async () => {
    const target = toCompressionTarget(100, "KB");
    render(<FixedTargetCompressionWorkbench locale="en" target={target} />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Compress" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    await waitFor(() => expect(png.enqueuedIds).toHaveLength(1));
    expect(png.client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ targetBytes: 100_000 }),
      expect.anything(),
    );
  });
});
