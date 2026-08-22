import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AVIF_INPUT_BYTES } from "./avif-conversion-types";
import { createHeicConversionClient } from "./heic-conversion-client";
import { getImageDimensions } from "./image-dimensions";
import { MAX_RASTER_PRE_DECODE_INPUT_BYTES } from "./raster-pre-decode-safety";
import { useImageIntake } from "./use-image-intake";
import type { HeicConversionClient, HeicConvertOutcome } from "./heic-conversion-client";

/**
 * heic-conversion-client(WASM Worker)・image-dimensions(createImageBitmap相当の実デコード)の
 * どちらも実際には呼ばず、allowedFormatsによる早期ガードが「Workerを起動する/寸法取得を試みる
 * 前」に効いていることを確認する(heic-flow.test.tsxと同じモック方針)。
 */
vi.mock("./heic-conversion-client", () => ({
  createHeicConversionClient: vi.fn(),
}));
vi.mock("./image-dimensions", () => ({
  getImageDimensions: vi.fn(),
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

function createHeicFile(name = "photo.heic"): File {
  return new File([buildFtypBytes("heic", ["mif1", "heix", "hevc"])], name, {
    type: "image/heic",
  });
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function createPngFile(name = "photo.png"): File {
  return new File([new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 0])], name, { type: "image/png" });
}

/** readDeclaredDimensions("png")が読み取れる最小限のIHDR付きPNG(image-header-dimensions.tsのreadPngDimensions参照) */
function buildPngBytesWithDimensions(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  bytes[8] = 0;
  bytes[9] = 0;
  bytes[10] = 0;
  bytes[11] = 13;
  "IHDR".split("").forEach((c, i) => (bytes[12 + i] = c.charCodeAt(0)));
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}
function createPngFileWithDimensions(width: number, height: number, name = "photo.png"): File {
  return new File([buildPngBytesWithDimensions(width, height)], name, { type: "image/png" });
}

/** readDeclaredDimensions("jpeg")が読み取れる最小限のSOF0付きJPEG(image-header-dimensions.tsのreadJpegDimensions参照) */
function buildJpegBytesWithDimensions(width: number, height: number) {
  const bytes = new Uint8Array(11);
  bytes[0] = 0xff;
  bytes[1] = 0xd8; // SOI
  bytes[2] = 0xff;
  bytes[3] = 0xc0; // SOF0
  bytes[4] = 0;
  bytes[5] = 7; // length field
  bytes[6] = 8; // precision
  bytes[7] = (height >>> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >>> 8) & 0xff;
  bytes[10] = width & 0xff;
  return bytes;
}
function createJpegFileWithDimensions(width: number, height: number, name = "photo.jpg"): File {
  return new File([buildJpegBytesWithDimensions(width, height)], name, { type: "image/jpeg" });
}

const RIFF_WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
function createWebpFile(name = "photo.webp"): File {
  return new File([new Uint8Array(RIFF_WEBP_SIGNATURE)], name, { type: "image/webp" });
}

// --- AVIFフィクスチャ(avif-isobmff.test.tsと同じボックス組み立て方) ---
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
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
) {
  // 戻り値型を明示的に`Uint8Array`とだけ書くと、TypeScriptがUint8Array<ArrayBufferLike>
  // (SharedArrayBufferを含み得る、より広い型)へ広げてしまい、new File([...])が要求する
  // BlobPart(ArrayBufferView<ArrayBuffer>)に代入できなくなる。戻り値型注釈を省略し、
  // new Uint8Array(numberArray)の具体的な推論結果(Uint8Array<ArrayBuffer>)をそのまま使う。
  const ftyp = ftypBox(options.animated ? ["avis", "msf1"] : ["mif1", "miaf"]);
  const ispeBoxes = candidates.flatMap((c) => box("ispe", ispePayload(c.width, c.height)));
  const ipco = box("ipco", ispeBoxes);
  const iprp = box("iprp", ipco);
  const meta = box("meta", metaPayload(iprp));
  return new Uint8Array([...ftyp, ...meta]);
}
function createAvifFile(
  candidates: Array<{ width: number; height: number }>,
  options: { animated?: boolean; name?: string } = {},
): File {
  return new File([buildAvifBytes(candidates, options)], options.name ?? "photo.avif", {
    type: "image/avif",
  });
}

function createControllableHeicClient(): {
  client: HeicConversionClient;
  enqueuedIds: string[];
} {
  const enqueuedIds: string[] = [];
  const client: HeicConversionClient = {
    enqueue: vi.fn((task: { id: string }) => {
      enqueuedIds.push(task.id);
      return new Promise<HeicConvertOutcome>(() => {});
    }),
    cancel: vi.fn(() => false),
    cancelAll: vi.fn(),
    destroy: vi.fn(),
  };
  return { client, enqueuedIds };
}

describe("useImageIntake — allowedFormats", () => {
  let heic: ReturnType<typeof createControllableHeicClient>;

  beforeEach(() => {
    heic = createControllableHeicClient();
    vi.mocked(createHeicConversionClient).mockReturnValue(heic.client);
    vi.mocked(getImageDimensions).mockResolvedValue({ width: 100, height: 100 });
    // detectHeicConversionSupport()がtrueになるよう、HEICパイプラインに必要なブラウザ機能を揃える
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("allowedFormats未指定時、HEICは従来通りheic-conversion-clientへenqueueされる(既存動作を維持)", async () => {
    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([createHeicFile()]);
    });

    await waitFor(() => expect(heic.enqueuedIds).toHaveLength(1));
  });

  it("allowedFormats=['png']のページへHEICをdropしても、heic-conversion-clientへenqueueされない", async () => {
    const { result } = renderHook(() => useImageIntake({ allowedFormats: ["png"] }));

    act(() => {
      result.current.addFiles([createHeicFile()]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("unsupported-format");
    });
    expect(heic.client.enqueue).not.toHaveBeenCalled();
    expect(result.current.items[0].detectedFormat).toBe("heic");
  });

  it("allowedFormats=['webp']のページへHEICをdropしても、heic-conversion-clientへenqueueされない", async () => {
    const { result } = renderHook(() => useImageIntake({ allowedFormats: ["webp"] }));

    act(() => {
      result.current.addFiles([createHeicFile()]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("unsupported-format");
    });
    expect(heic.client.enqueue).not.toHaveBeenCalled();
  });

  it("allowedFormats=['png']のページへ実在するがpng以外の形式(webp)をdropしても、寸法取得(getImageDimensions)を試みない", async () => {
    const { result } = renderHook(() => useImageIntake({ allowedFormats: ["png"] }));

    act(() => {
      result.current.addFiles([createWebpFile()]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("unsupported-format");
    });
    expect(getImageDimensions).not.toHaveBeenCalled();
    expect(result.current.items[0].detectedFormat).toBe("webp");
  });

  it("allowedFormats=['png']のページへPNGをdropすると、通常通りreadyになる", async () => {
    const { result } = renderHook(() => useImageIntake({ allowedFormats: ["png"] }));

    act(() => {
      result.current.addFiles([createPngFile()]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("ready");
    });
    expect(result.current.items[0].detectedFormat).toBe("png");
  });

  it("そもそも画像として認識できないファイルは、allowedFormats指定時もdetectedFormat=nullのunsupported-formatになる", async () => {
    const { result } = renderHook(() => useImageIntake({ allowedFormats: ["png"] }));
    const junkFile = new File([new Uint8Array([1, 2, 3, 4])], "junk.bin", {
      type: "application/octet-stream",
    });

    act(() => {
      result.current.addFiles([junkFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("unsupported-format");
    });
    expect(result.current.items[0].detectedFormat).toBeNull();
  });
});

describe("useImageIntake — AVIF pre-decode safety", () => {
  beforeEach(() => {
    // vi.mock(...)のfactoryで作られたvi.fn()はvi.restoreAllMocks()の対象外(vi.spyOnで
    // 作られたスパイのみが対象)のため、呼び出し履歴は明示的にmockClear()で毎回リセットする。
    vi.mocked(getImageDimensions).mockClear();
    vi.mocked(getImageDimensions).mockResolvedValue({ width: 100, height: 100 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ispe候補が安全な場合、getImageDimensionsを呼んでreadyになる", async () => {
    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([createAvifFile([{ width: 800, height: 600 }])]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("ready");
    });
    expect(result.current.items[0].detectedFormat).toBe("avif");
    expect(getImageDimensions).toHaveBeenCalledTimes(1);
  });

  it("ファイルサイズがMAX_AVIF_INPUT_BYTESを超える場合、file.arrayBuffer()を呼ぶ前にavif-too-largeになる", async () => {
    const bytes = buildAvifBytes([{ width: 800, height: 600 }]);
    const padded = new Uint8Array(Math.max(MAX_AVIF_INPUT_BYTES + 1, bytes.length));
    padded.set(bytes);
    const oversizedFile = new File([padded], "huge.avif", { type: "image/avif" });
    const arrayBufferSpy = vi.spyOn(oversizedFile, "arrayBuffer");

    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([oversizedFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("avif-too-large");
    });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("avisブランド(image sequence)を持つAVIFは、getImageDimensionsを呼ぶ前にavif-unsupported-animationになる", async () => {
    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([createAvifFile([{ width: 800, height: 600 }], { animated: true })]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("avif-unsupported-animation");
    });
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("ispe候補が1件も無い場合、getImageDimensionsを呼ぶ前にavif-unsafe-dimensionsになる", async () => {
    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([createAvifFile([])]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("avif-unsafe-dimensions");
    });
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("1件でも安全上限を超えるispe候補がある場合、他の候補が安全でもgetImageDimensionsを呼ぶ前にavif-unsafe-dimensionsになる(合成せず個別検証)", async () => {
    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([
        createAvifFile([
          { width: 800, height: 600 }, // 安全な候補
          { width: 20000, height: 20000 }, // 安全上限を超える候補
        ]),
      ]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("avif-unsafe-dimensions");
    });
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("ispe検証までは安全と判断できても、実デコード(getImageDimensions)自体が失敗した場合はavif-decode-failedになる(原因を断定しない専用メッセージ)", async () => {
    // 実ブラウザでは、ispe上は安全な寸法を宣言していても、ブラウザのAVIFデコーダが対応していない
    // AVIFプロファイルや壊れたビットストリームにより実デコードが失敗し得る。この場合に汎用の
    // "error"(analyzeFailed)へフォールバックしていないことを確認する回帰テスト。
    vi.mocked(getImageDimensions).mockRejectedValue(new Error("画像を読み込めませんでした"));
    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([createAvifFile([{ width: 800, height: 600 }])]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("avif-decode-failed");
    });
  });

  it("allowedFormats=['avif']以外のページへAVIFをdropしても、file.arrayBuffer()やgetImageDimensionsを試みない", async () => {
    const avifFile = createAvifFile([{ width: 800, height: 600 }]);
    const arrayBufferSpy = vi.spyOn(avifFile, "arrayBuffer");
    const { result } = renderHook(() => useImageIntake({ allowedFormats: ["png"] }));

    act(() => {
      result.current.addFiles([avifFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("unsupported-format");
    });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(getImageDimensions).not.toHaveBeenCalled();
    expect(result.current.items[0].detectedFormat).toBe("avif");
  });

  it("大量のAVIFを同時にdropしても、既存のdecode-queue(DEFAULT_MAX_CONCURRENT_DECODES=2)を共有し、getImageDimensionsの同時実行数が2を超えない", async () => {
    let concurrent = 0;
    let maxObserved = 0;
    const resolvers: Array<() => void> = [];
    vi.mocked(getImageDimensions).mockImplementation(
      () =>
        new Promise((resolve) => {
          concurrent += 1;
          maxObserved = Math.max(maxObserved, concurrent);
          resolvers.push(() => {
            concurrent -= 1;
            resolve({ width: 100, height: 100 });
          });
        }),
    );

    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([
        createAvifFile([{ width: 800, height: 600 }], { name: "a.avif" }),
        createAvifFile([{ width: 800, height: 600 }], { name: "b.avif" }),
        createAvifFile([{ width: 800, height: 600 }], { name: "c.avif" }),
      ]);
    });

    // 3件ともispe検証自体は完了しているはずだが、getImageDimensions呼び出しは
    // decode-queueの同時実行数(2)までしか進まない
    await waitFor(() => expect(getImageDimensions).toHaveBeenCalledTimes(2));
    expect(concurrent).toBe(2);

    // 1件resolveすると、3件目のgetImageDimensions呼び出しが進む
    act(() => resolvers[0]());
    await waitFor(() => expect(getImageDimensions).toHaveBeenCalledTimes(3));

    act(() => resolvers.slice(1).forEach((r) => r()));
    await waitFor(() => {
      expect(result.current.items.every((item) => item.status.kind === "ready")).toBe(true);
    });
    expect(maxObserved).toBe(2);
  });
});

describe("useImageIntake — enableRasterPreDecodeSafety(opt-in)", () => {
  beforeEach(() => {
    vi.mocked(getImageDimensions).mockClear();
    vi.mocked(getImageDimensions).mockResolvedValue({ width: 100, height: 100 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("既定(未指定)では、JPEG/PNGはfile.arrayBuffer()を呼ばず、直接getImageDimensionsへ進む(既存ツールは無変更)", async () => {
    const pngFile = createPngFileWithDimensions(400, 300);
    const arrayBufferSpy = vi.spyOn(pngFile, "arrayBuffer");
    const { result } = renderHook(() => useImageIntake());

    act(() => {
      result.current.addFiles([pngFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("ready");
    });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(getImageDimensions).toHaveBeenCalledTimes(1);
  });

  it("enableRasterPreDecodeSafety:trueかつ安全な寸法のPNGは、file.arrayBuffer()経由でheader検証してからreadyになる", async () => {
    const pngFile = createPngFileWithDimensions(400, 300);
    const arrayBufferSpy = vi.spyOn(pngFile, "arrayBuffer");
    const { result } = renderHook(() =>
      useImageIntake({ allowedFormats: ["jpeg", "png"], enableRasterPreDecodeSafety: true }),
    );

    act(() => {
      result.current.addFiles([pngFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("ready");
    });
    expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
    expect(getImageDimensions).toHaveBeenCalledTimes(1);
  });

  it("enableRasterPreDecodeSafety:trueかつ安全な寸法のJPEGも、同様にreadyになる", async () => {
    const jpegFile = createJpegFileWithDimensions(640, 480);
    const { result } = renderHook(() =>
      useImageIntake({ allowedFormats: ["jpeg", "png"], enableRasterPreDecodeSafety: true }),
    );

    act(() => {
      result.current.addFiles([jpegFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("ready");
    });
    expect(result.current.items[0].detectedFormat).toBe("jpeg");
  });

  it("ファイルサイズがMAX_RASTER_PRE_DECODE_INPUT_BYTESを超える場合、file.arrayBuffer()を呼ぶ前にraster-too-largeになる", async () => {
    const bytes = buildPngBytesWithDimensionsPadded(
      400,
      300,
      MAX_RASTER_PRE_DECODE_INPUT_BYTES + 1,
    );
    const oversizedFile = new File([bytes], "huge.png", { type: "image/png" });
    const arrayBufferSpy = vi.spyOn(oversizedFile, "arrayBuffer");
    const { result } = renderHook(() =>
      useImageIntake({ allowedFormats: ["png"], enableRasterPreDecodeSafety: true }),
    );

    act(() => {
      result.current.addFiles([oversizedFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("raster-too-large");
    });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("宣言寸法が安全上限を超えるPNGは、getImageDimensionsを呼ぶ前にraster-unsafe-dimensionsになる", async () => {
    const pngFile = createPngFileWithDimensions(99999, 99999);
    const { result } = renderHook(() =>
      useImageIntake({ allowedFormats: ["png"], enableRasterPreDecodeSafety: true }),
    );

    act(() => {
      result.current.addFiles([pngFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("raster-unsafe-dimensions");
    });
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("ヘッダーを解析できないPNG(壊れたIHDR)は、getImageDimensionsを呼ぶ前にraster-unsafe-dimensionsになる", async () => {
    const malformedFile = createPngFile(); // 既存ヘルパー: IHDRを持たない12バイトのみ
    const { result } = renderHook(() =>
      useImageIntake({ allowedFormats: ["png"], enableRasterPreDecodeSafety: true }),
    );

    act(() => {
      result.current.addFiles([malformedFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("raster-unsafe-dimensions");
    });
    expect(getImageDimensions).not.toHaveBeenCalled();
  });

  it("宣言寸法検証までは安全でも、実デコード(getImageDimensions)自体が失敗した場合はraster-decode-failedになる", async () => {
    vi.mocked(getImageDimensions).mockRejectedValue(new Error("画像を読み込めませんでした"));
    const pngFile = createPngFileWithDimensions(400, 300);
    const { result } = renderHook(() =>
      useImageIntake({ allowedFormats: ["png"], enableRasterPreDecodeSafety: true }),
    );

    act(() => {
      result.current.addFiles([pngFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("raster-decode-failed");
    });
  });

  it("allowedFormats対象外の形式は、enableRasterPreDecodeSafety:trueでもfile.arrayBuffer()を試みない(allowedFormatsのガードが先に効く)", async () => {
    const webpFile = createWebpFile();
    const arrayBufferSpy = vi.spyOn(webpFile, "arrayBuffer");
    const { result } = renderHook(() =>
      useImageIntake({ allowedFormats: ["png"], enableRasterPreDecodeSafety: true }),
    );

    act(() => {
      result.current.addFiles([webpFile]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status.kind).toBe("unsupported-format");
    });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });
});

/** buildPngBytesWithDimensionsの結果を、指定した合計バイト数までパディングする(file.size境界値テスト用) */
function buildPngBytesWithDimensionsPadded(width: number, height: number, totalBytes: number) {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  bytes[8] = 0;
  bytes[9] = 0;
  bytes[10] = 0;
  bytes[11] = 13;
  "IHDR".split("").forEach((c, i) => (bytes[12 + i] = c.charCodeAt(0)));
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  const padded = new Uint8Array(totalBytes);
  padded.set(bytes);
  return padded;
}
