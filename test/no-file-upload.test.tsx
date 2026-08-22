import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageWorkbench } from "../src/components/ImageWorkbench";
import { createHeicConversionClient } from "../src/components/image-intake/heic-conversion-client";
import type {
  HeicConversionClient,
  HeicConvertOutcome,
} from "../src/components/image-intake/heic-conversion-client";

/**
 * 選択ファイルの外部送信を防ぐための回帰テスト。
 * 「ネットワーク通信が一切無いこと」ではなく、現在の画像解析フローにおいて
 * 選択ファイル(File/Blob)がfetch・XMLHttpRequest・FormData経由で外部に渡されないことを検証する。
 */

vi.mock("../src/components/image-intake/heic-conversion-client", () => ({
  createHeicConversionClient: vi.fn(),
}));

const mockUpngEncode = vi.fn();
vi.mock("@upng/upng-js/dist/UPNG.esm.js", () => ({
  default: { encode: (...args: unknown[]) => mockUpngEncode(...args) },
}));

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];

function createJpegFile(name = "photo.jpg"): File {
  return new File([new Uint8Array(JPEG_BYTES)], name, { type: "image/jpeg" });
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
  return new File([buildFtypBytes("heic", ["mif1", "heix", "hevc"])], name, { type: "image/heic" });
}

function createControllableHeicClient(): {
  client: HeicConversionClient;
  resolveAll(outcome: HeicConvertOutcome): void;
} {
  const resolvers: Array<(outcome: HeicConvertOutcome) => void> = [];
  const client: HeicConversionClient = {
    enqueue: vi.fn(
      (_task, callbacks) =>
        new Promise<HeicConvertOutcome>((resolve) => {
          callbacks?.onStart?.();
          resolvers.push(resolve);
        }),
    ),
    cancel: vi.fn(() => false),
    cancelAll: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    client,
    resolveAll(outcome) {
      for (const resolve of resolvers) resolve(outcome);
    },
  };
}

/**
 * jsdomは実際の画像読み込みを行わないため、Imageのonloadが発火しない。
 * 解析完了(status: ready)まで到達させるため、テスト内でのみImageをスタブする。
 */
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 100;
  naturalHeight = 100;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe("選択ファイルの外部送信を防ぐための回帰テスト", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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
    vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);
    vi.spyOn(FormData.prototype, "append");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("画像選択から解析完了までの間、選択ファイルがfetch/XHR/FormDataとして送信されない", async () => {
    render(<ImageWorkbench locale="ja" />);

    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    const file = createJpegFile();

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("解析中…")).not.toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(XMLHttpRequest.prototype.send).not.toHaveBeenCalled();

    const filePayloadsAppendedToFormData = (
      FormData.prototype.append as ReturnType<typeof vi.fn>
    ).mock.calls.filter(([, value]) => value instanceof Blob);
    expect(filePayloadsAppendedToFormData).toHaveLength(0);
  });

  it("HEIC変換フローでも、選択ファイルがfetch/XHR/FormDataとして送信されない", async () => {
    const { client, resolveAll } = createControllableHeicClient();
    vi.mocked(createHeicConversionClient).mockReturnValue(client);

    render(<ImageWorkbench locale="ja" />);

    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createHeicFile()] } });

    await waitFor(() => {
      expect(screen.getByText("JPGへ変換中…")).toBeInTheDocument();
    });

    resolveAll({
      status: "done",
      jpegBuffer: new ArrayBuffer(8),
      jpegType: "image/jpeg",
      width: 10,
      height: 10,
    });

    await waitFor(() => {
      expect(screen.getByText("HEICを互換性の高いJPGへ変換しました")).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(XMLHttpRequest.prototype.send).not.toHaveBeenCalled();

    const filePayloadsAppendedToFormData = (
      FormData.prototype.append as ReturnType<typeof vi.fn>
    ).mock.calls.filter(([, value]) => value instanceof Blob);
    expect(filePayloadsAppendedToFormData).toHaveLength(0);
  });
});

/**
 * PNG指定容量圧縮エンジン(src/components/png-compression/)の回帰テスト。
 * まだどのページ・フックからもimportされていないため、ImageWorkbench経由ではなく
 * Worker(self.onmessage)を直接叩く形で、fetch/XHR/FormData/sendBeaconが
 * 一切発生しないことを確認する。
 */
describe("PNG指定容量圧縮エンジンが選択ファイルを外部送信しない回帰テスト", () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
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
  function buildPng(width: number, height: number, idatBytes: number[]): ArrayBuffer {
    return new Uint8Array([
      ...PNG_SIGNATURE,
      ...pngChunk("IHDR", ihdrData(width, height)),
      ...pngChunk("IDAT", idatBytes),
      ...pngChunk("IEND", []),
    ]).buffer;
  }

  class StubBitmap {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    close(): void {}
  }

  class StubOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        drawImage: vi.fn(),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
      };
    }
  }

  let sendBeaconMock: ReturnType<typeof vi.fn>;
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mockUpngEncode.mockReset();
    mockUpngEncode.mockImplementation((_imgs, w, h) => buildPng(w, h, new Array(2000).fill(1)));

    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async (blob: Blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
        const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
        return new StubBitmap(width, height);
      }),
    );
    vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);
    vi.spyOn(FormData.prototype, "append");
    sendBeaconMock = vi.fn();
    vi.stubGlobal("navigator", { ...globalThis.navigator, sendBeacon: sendBeaconMock });

    postMessageSpy = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    vi.resetModules();
    await import("../src/components/png-compression/png-compression.worker");
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("圧縮処理(実エンコード経路)の間、選択ファイルがfetch/XHR/FormData/sendBeaconとして送信されない", async () => {
    // 入力(約5000byte)はtargetBytes(3000)を上回るため元ファイル返却されず実エンコード経路を通る。
    // モックのencodeは常に約2060byteを返すため、フルサイズ・1候補目で目標を満たす。
    const buffer = buildPng(800, 600, new Array(5000).fill(1));
    const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
    await handler({ data: { id: "a", buffer, targetBytes: 3000 } } as MessageEvent);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const outcome = postMessageSpy.mock.calls[0]?.[0] as { outcome: { status: string } };
    expect(outcome.outcome.status).toBe("done");

    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest.prototype.send).not.toHaveBeenCalled();
    expect(sendBeaconMock).not.toHaveBeenCalled();

    const filePayloadsAppendedToFormData = (
      FormData.prototype.append as ReturnType<typeof vi.fn>
    ).mock.calls.filter(([, value]) => value instanceof Blob);
    expect(filePayloadsAppendedToFormData).toHaveLength(0);
  });

  it("元ファイル返却(再エンコード無し)の経路でも外部送信は発生しない", async () => {
    const buffer = buildPng(10, 10, [1, 2, 3]);
    const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
    await handler({
      data: { id: "a", buffer, targetBytes: buffer.byteLength + 100 },
    } as MessageEvent);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const outcome = postMessageSpy.mock.calls[0]?.[0] as {
      outcome: { status: string; originalReturned?: boolean };
    };
    expect(outcome.outcome.status).toBe("done");
    expect(outcome.outcome.originalReturned).toBe(true);

    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest.prototype.send).not.toHaveBeenCalled();
    expect(sendBeaconMock).not.toHaveBeenCalled();
  });
});
