import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RasterToJpgWorkbench } from "./RasterToJpgWorkbench";
import { createHeicConversionClient } from "./image-intake/heic-conversion-client";
import { createRasterConvertClient } from "./image-intake/raster-convert-client";
import type {
  HeicConversionClient,
  HeicConvertOutcome,
  HeicConvertTask,
} from "./image-intake/heic-conversion-client";
import type {
  RasterConvertClient,
  RasterConvertOutcome,
} from "./image-intake/raster-convert-client";

vi.mock("./image-intake/raster-convert-client", () => ({
  createRasterConvertClient: vi.fn(),
}));
// PNG/WebP専用ページへ誤ってHEICをdropした際、HEIC変換(WASM Worker)が一切起動しないことを
// 検証するため、heic-conversion-clientもモックする(heic-flow.test.tsxと同じ方針)。
vi.mock("./image-intake/heic-conversion-client", () => ({
  createHeicConversionClient: vi.fn(),
}));

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
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

function riffHeader(payloadLength: number): number[] {
  return [...ascii("RIFF"), ...u32le(4 + payloadLength), ...ascii("WEBP")];
}
function webpChunk(fourCC: string, payload: number[]): number[] {
  const padding = payload.length % 2 === 1 ? [0] : [];
  return [...ascii(fourCC), ...u32le(payload.length), ...payload, ...padding];
}
function vp8xChunk(width: number, height: number, animationFlag: boolean): number[] {
  const flags = animationFlag ? 0x02 : 0x00;
  const payload = [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  return webpChunk("VP8X", payload);
}
function buildWebpBytes(options: { width?: number; height?: number; animated?: boolean } = {}) {
  const chunk = vp8xChunk(options.width ?? 500, options.height ?? 500, options.animated ?? false);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

function createFile(bytes: number[] | Uint8Array, name: string, type: string): File {
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

function createHeicFile(name = "photo.heic"): File {
  return new File([buildFtypBytes("heic", ["mif1", "heix", "hevc"])], name, {
    type: "image/heic",
  });
}

// --- AVIFフィクスチャ(avif-isobmff.test.tsと同じボックス組み立て方) ---
function ascii4(type: string): number[] {
  return type.split("").map((c) => c.charCodeAt(0));
}
function box(type: string, payload: number[]): number[] {
  const totalSize = 8 + payload.length;
  return [...u32be(totalSize), ...ascii4(type), ...payload];
}
function ftypBox(compatibleBrands: string[]): number[] {
  return box("ftyp", [...ascii4("avif"), ...u32be(0), ...compatibleBrands.flatMap(ascii4)]);
}
function ispePayload(width: number, height: number): number[] {
  return [...u32be(0), ...u32be(width), ...u32be(height)];
}
function metaPayload(children: number[]): number[] {
  return [...u32be(0), ...children];
}
function buildAvifBytes(
  candidates: Array<{ width: number; height: number }>,
  options: { animated?: boolean } = {},
): Uint8Array {
  const ftyp = ftypBox(options.animated ? ["avis", "msf1"] : ["mif1", "miaf"]);
  const ispeBoxes = candidates.flatMap((c) => box("ispe", ispePayload(c.width, c.height)));
  const ipco = box("ipco", ispeBoxes);
  const iprp = box("iprp", ipco);
  const meta = box("meta", metaPayload(iprp));
  return new Uint8Array([...ftyp, ...meta]);
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
  client: RasterConvertClient;
  enqueuedIds: string[];
  resolve(id: string, outcome: RasterConvertOutcome): void;
  cancelMock: ReturnType<typeof vi.fn>;
  cancelAllMock: ReturnType<typeof vi.fn>;
}

function createControllableClient(): ControllableClient {
  const resolvers = new Map<string, (outcome: RasterConvertOutcome) => void>();
  const enqueuedIds: string[] = [];
  const cancelMock = vi.fn(() => false);
  const cancelAllMock = vi.fn();
  const client: RasterConvertClient = {
    enqueue: vi.fn((task) => {
      enqueuedIds.push(task.id);
      return new Promise<RasterConvertOutcome>((resolve) => resolvers.set(task.id, resolve));
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

describe("RasterToJpgWorkbench", () => {
  let conversion: ControllableClient;
  let heicEnqueueMock: ReturnType<
    typeof vi.fn<
      (task: HeicConvertTask, callbacks?: { onStart?: () => void }) => Promise<HeicConvertOutcome>
    >
  >;

  beforeEach(() => {
    conversion = createControllableClient();
    vi.mocked(createRasterConvertClient).mockReturnValue(conversion.client);

    heicEnqueueMock = vi.fn(() => new Promise<HeicConvertOutcome>(() => {}));
    const heicClient: HeicConversionClient = {
      enqueue: heicEnqueueMock,
      cancel: vi.fn(() => false),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(createHeicConversionClient).mockReturnValue(heicClient);

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

  describe("sourceFormat=png", () => {
    it("PNGを選択すると、非同期チェック後に画質選択・変換ボタンが表示される", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument();
      });
      expect(screen.getByLabelText("透明部分の背景色")).toBeInTheDocument();
    });

    it("input[type=file]のaccept属性はPNGに限定される(OSファイル選択のヒント)", () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      expect(input.accept).toBe("image/png,.png");
    });

    it("WebPを選択すると「PNG→JPG変換は現在PNGのみに対応しています」と表示され、変換ボタンは出ない", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildWebpBytes(), "photo.webp", "image/webp")]);

      await waitFor(() => {
        expect(screen.getByText("PNG→JPG変換は現在PNGのみに対応しています")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("HEICを選択してもheic-conversion-clientへenqueueされない(HEIC WASM変換を開始しない)", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createHeicFile()]);

      await waitFor(() => {
        expect(screen.getByText("PNG→JPG変換は現在PNGのみに対応しています")).toBeInTheDocument();
      });
      expect(heicEnqueueMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("JPEGを選択しても対応形式ではないと表示される", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

      await waitFor(() => {
        expect(screen.getByText("PNG→JPG変換は現在PNGのみに対応しています")).toBeInTheDocument();
      });
    });

    it("アニメーションPNGを選択すると拒否メッセージが表示され、変換ボタンは出ない", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes({ animated: true }), "anim.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getByText("アニメーションPNGには現在対応していません。")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("変換するを押すと変換が実行され、成功時にJPGを確認が表示される", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "JPGへ変換する" }));

      await waitFor(() => expect(conversion.enqueuedIds).toHaveLength(1));

      conversion.resolve(conversion.enqueuedIds[0], {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 500,
        height: 500,
        quality: 0.8,
        elapsedMs: 100,
      });

      await waitFor(() => {
        expect(screen.getByText("JPGへ変換しました")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "JPGを確認" })).toBeInTheDocument();
    });

    it("個別削除すると変換クライアントのcancelが呼ばれる", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "photo.pngを削除" }));

      expect(conversion.cancelMock).toHaveBeenCalled();
      expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    });

    it("個別削除は1回だけremoveJob相当の後始末を行う(RasterToJpgListItem/Workbench双方が呼んで二重cancelしない)", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "photo.pngを削除" }));

      expect(conversion.cancelMock).toHaveBeenCalledTimes(1);
    });

    it("すべて削除すると変換クライアントのcancelAllが呼ばれる", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));

      expect(conversion.cancelAllMock).toHaveBeenCalledTimes(1);
    });

    it("Worker等が非対応の環境では非対応バナーを表示し、変換パネルは表示しない", async () => {
      vi.stubGlobal("Worker", undefined);
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);

      expect(
        screen.getByText("このブラウザはJPG変換に必要な機能へ対応していません"),
      ).toBeInTheDocument();

      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("画像選択操作やファイル送信フローで外部通信は発生しない", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const sendSpy = vi
        .spyOn(XMLHttpRequest.prototype, "send")
        .mockImplementation(() => undefined);

      render(<RasterToJpgWorkbench locale="ja" sourceFormat="png" sourceFormatLabel="PNG" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "JPGへ変換する" }));
      await waitFor(() => expect(conversion.enqueuedIds).toHaveLength(1));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    describe("locale=en", () => {
      it("英語文言でレンダーされ、既存の日本語UI文言が残らない", () => {
        const { container } = render(
          <RasterToJpgWorkbench locale="en" sourceFormat="png" sourceFormatLabel="PNG" />,
        );
        expect(screen.getByText("Select an image, or drag and drop it here")).toBeInTheDocument();
        expect(
          screen.getByText(
            "Your images are processed on this device and are never sent to a server.",
          ),
        ).toBeInTheDocument();

        const text = container.textContent ?? "";
        expect(text).not.toContain("画像を選択、またはここにドラッグ&ドロップ");
        expect(text).not.toContain("画像はこの端末内で処理され");
      });
    });
  });

  describe("sourceFormat=webp", () => {
    it("WebPを選択すると、非同期チェック後に画質選択・変換ボタンが表示される", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="webp" sourceFormatLabel="WebP" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildWebpBytes(), "photo.webp", "image/webp")]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument();
      });
    });

    it("input[type=file]のaccept属性はWebPに限定される(OSファイル選択のヒント)", () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="webp" sourceFormatLabel="WebP" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      expect(input.accept).toBe("image/webp,.webp");
    });

    it("HEICを選択してもheic-conversion-clientへenqueueされない(HEIC WASM変換を開始しない)", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="webp" sourceFormatLabel="WebP" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createHeicFile()]);

      await waitFor(() => {
        expect(screen.getByText("WebP→JPG変換は現在WebPのみに対応しています")).toBeInTheDocument();
      });
      expect(heicEnqueueMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("PNGを選択すると「WebP→JPG変換は現在WebPのみに対応しています」と表示される", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="webp" sourceFormatLabel="WebP" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getByText("WebP→JPG変換は現在WebPのみに対応しています")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("アニメーションWebPを選択すると拒否メッセージが表示され、変換ボタンは出ない", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="webp" sourceFormatLabel="WebP" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildWebpBytes({ animated: true }), "anim.webp", "image/webp"),
      ]);

      await waitFor(() => {
        expect(
          screen.getByText("アニメーションWebPには現在対応していません。"),
        ).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("変換するを押すと変換が実行され、成功時にJPGを確認が表示される", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="webp" sourceFormatLabel="WebP" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildWebpBytes(), "photo.webp", "image/webp")]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "JPGへ変換する" }));

      await waitFor(() => expect(conversion.enqueuedIds).toHaveLength(1));
      expect(conversion.client.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ sourceFormat: "webp" }),
        expect.anything(),
      );

      conversion.resolve(conversion.enqueuedIds[0], {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 500,
        height: 500,
        quality: 0.8,
        elapsedMs: 100,
      });

      await waitFor(() => {
        expect(screen.getByText("JPGへ変換しました")).toBeInTheDocument();
      });
    });
  });

  describe("sourceFormat=avif", () => {
    it("AVIFを選択すると、非同期チェック後に画質選択・変換ボタンが表示される(intake側で既に安全性検証済み)", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="avif" sourceFormatLabel="AVIF" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildAvifBytes([{ width: 500, height: 500 }]), "photo.avif", "image/avif"),
      ]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument();
      });
      expect(screen.getByLabelText("透明部分の背景色")).toBeInTheDocument();
    });

    it("input[type=file]のaccept属性はAVIFに限定される(OSファイル選択のヒント)", () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="avif" sourceFormatLabel="AVIF" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      expect(input.accept).toBe("image/avif,.avif");
    });

    it("PNGを選択すると「AVIF→JPG変換は現在AVIFのみに対応しています」と表示され、変換ボタンは出ない", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="avif" sourceFormatLabel="AVIF" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildPngBytes(), "photo.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getByText("AVIF→JPG変換は現在AVIFのみに対応しています")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("HEICを選択してもheic-conversion-clientへenqueueされない(HEIC WASM変換を開始しない)", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="avif" sourceFormatLabel="AVIF" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createHeicFile()]);

      await waitFor(() => {
        expect(screen.getByText("AVIF→JPG変換は現在AVIFのみに対応しています")).toBeInTheDocument();
      });
      expect(heicEnqueueMock).not.toHaveBeenCalled();
    });

    it("avisブランド(image sequence)を持つAVIFを選択すると拒否メッセージが表示され、変換ボタンは出ない(getImageDimensionsを呼ぶ前に拒否)", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="avif" sourceFormatLabel="AVIF" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(
          buildAvifBytes([{ width: 500, height: 500 }], { animated: true }),
          "anim.avif",
          "image/avif",
        ),
      ]);

      await waitFor(() => {
        expect(
          screen.getByText("アニメーションAVIF(image sequence)には現在対応していません。"),
        ).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("ispe候補が1件も無いAVIFを選択すると、安全性エラーが表示され変換ボタンは出ない", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="avif" sourceFormatLabel="AVIF" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(buildAvifBytes([]), "noispe.avif", "image/avif")]);

      await waitFor(() => {
        expect(
          screen.getByText("このAVIF画像のサイズが大きすぎるため、安全に処理できませんでした。"),
        ).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("ispe検証は安全でも実デコード(Image要素)自体が失敗すると、原因を断定しない専用メッセージが表示される", async () => {
      nextImageShouldFail = true;
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="avif" sourceFormatLabel="AVIF" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildAvifBytes([{ width: 500, height: 500 }]), "corrupt.avif", "image/avif"),
      ]);

      await waitFor(() => {
        expect(
          screen.getByText(
            "このAVIFをデコードできませんでした。ブラウザがこのAVIFに対応していないか、ファイルが壊れている可能性があります。",
          ),
        ).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "JPGへ変換する" })).not.toBeInTheDocument();
    });

    it("変換するを押すと変換が実行され、成功時にJPGを確認が表示される", async () => {
      render(<RasterToJpgWorkbench locale="ja" sourceFormat="avif" sourceFormatLabel="AVIF" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(buildAvifBytes([{ width: 500, height: 500 }]), "photo.avif", "image/avif"),
      ]);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "JPGへ変換する" }));

      await waitFor(() => expect(conversion.enqueuedIds).toHaveLength(1));
      expect(conversion.client.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ sourceFormat: "avif" }),
        expect.anything(),
      );

      conversion.resolve(conversion.enqueuedIds[0], {
        status: "done",
        jpegBuffer: new ArrayBuffer(4),
        width: 500,
        height: 500,
        quality: 0.8,
        elapsedMs: 100,
      });

      await waitFor(() => {
        expect(screen.getByText("JPGへ変換しました")).toBeInTheDocument();
      });
    });
  });
});
