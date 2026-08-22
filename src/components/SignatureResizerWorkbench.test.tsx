import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignatureResizerWorkbench } from "./SignatureResizerWorkbench";
import { createTargetFitClient } from "./image-intake/target-fit-client";
import type { TargetFitClient, TargetFitClientOutcome } from "./image-intake/target-fit-client";

vi.mock("./image-intake/target-fit-client", () => ({
  createTargetFitClient: vi.fn(),
}));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildPngBytes(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
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
function createPngFile(width: number, height: number, name = "photo.png"): File {
  return new File([buildPngBytes(width, height)], name, { type: "image/png" });
}

function buildJpegBytes(width: number, height: number) {
  const bytes = new Uint8Array(11);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes[4] = 0;
  bytes[5] = 7;
  bytes[6] = 8;
  bytes[7] = (height >>> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >>> 8) & 0xff;
  bytes[10] = width & 0xff;
  return bytes;
}
function createJpegFile(width: number, height: number, name = "photo.jpg"): File {
  return new File([buildJpegBytes(width, height)], name, { type: "image/jpeg" });
}

const RIFF_WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
function createWebpFile(name = "photo.webp"): File {
  return new File([new Uint8Array(RIFF_WEBP_SIGNATURE)], name, { type: "image/webp" });
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

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function ascii4(t: string): number[] {
  return t.split("").map((c) => c.charCodeAt(0));
}
function box(type: string, payload: number[]): number[] {
  return [...u32be(8 + payload.length), ...ascii4(type), ...payload];
}
function createAvifFile(name = "photo.avif"): File {
  const ftyp = box("ftyp", [...ascii4("avif"), ...u32be(0), ...ascii4("mif1"), ...ascii4("miaf")]);
  const ispe = box("ispe", [...u32be(0), ...u32be(500), ...u32be(500)]);
  const ipco = box("ipco", ispe);
  const iprp = box("iprp", ipco);
  const meta = box("meta", [...u32be(0), ...iprp]);
  return new File([new Uint8Array([...ftyp, ...meta])], name, { type: "image/avif" });
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

interface ControllableClient {
  client: TargetFitClient;
  enqueuedIds: string[];
  lastRequest: Record<string, unknown> | undefined;
  resolve(id: string, outcome: TargetFitClientOutcome): void;
}

function createControllableClient(): ControllableClient {
  const resolvers = new Map<string, Array<(outcome: TargetFitClientOutcome) => void>>();
  const enqueuedIds: string[] = [];
  let lastRequest: Record<string, unknown> | undefined;
  const client: TargetFitClient = {
    enqueue: vi.fn((task) => {
      enqueuedIds.push(task.id);
      lastRequest = task as unknown as Record<string, unknown>;
      return new Promise<TargetFitClientOutcome>((resolve) => {
        const list = resolvers.get(task.id) ?? [];
        list.push(resolve);
        resolvers.set(task.id, list);
      });
    }),
    cancel: vi.fn(() => false),
    cancelAll: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    client,
    enqueuedIds,
    get lastRequest() {
      return lastRequest;
    },
    resolve(id, outcome) {
      resolvers.get(id)?.shift()?.(outcome);
    },
  };
}

async function fillForm(width: string, height: string, maxSizeKb: string) {
  const widthInput = screen.getByLabelText(/^Width$/) as HTMLInputElement;
  const heightInput = screen.getByLabelText(/^Height$/) as HTMLInputElement;
  const maxSizeInput = screen.getByLabelText(/Maximum file size/) as HTMLInputElement;
  fireEvent.input(widthInput, { target: { value: width } });
  fireEvent.input(heightInput, { target: { value: height } });
  fireEvent.input(maxSizeInput, { target: { value: maxSizeKb } });
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

describe("SignatureResizerWorkbench", () => {
  let controllable: ControllableClient;

  beforeEach(() => {
    controllable = createControllableClient();
    vi.mocked(createTargetFitClient).mockReturnValue(controllable.client);
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

  it("JPEGを選択すると変換フォーム(幅・高さ・最大ファイルサイズ)が表示される", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createJpegFile(400, 300)]);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Width$/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^Height$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Maximum file size/)).toBeInTheDocument();
  });

  it("PNGを選択しても変換フォームが表示される", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createPngFile(400, 300)]);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Width$/)).toBeInTheDocument();
    });
  });

  it("WebPを選択すると「Signature Resizer currently supports JPEG and PNG.」と表示され、full preflight(file.arrayBuffer)を開始しない", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    const webpFile = createWebpFile();
    const arrayBufferSpy = vi.spyOn(webpFile, "arrayBuffer");
    selectFiles(input, [webpFile]);

    await waitFor(() => {
      expect(
        screen.getByText("Signature Resizer currently supports JPEG and PNG."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/^Width$/)).not.toBeInTheDocument();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("HEICを選択すると対応外として表示され、HEIC変換Workerを起動しない", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createHeicFile()]);

    await waitFor(() => {
      expect(
        screen.getByText("Signature Resizer currently supports JPEG and PNG."),
      ).toBeInTheDocument();
    });
  });

  it("AVIFを選択すると対応外として表示され、AVIF全体のpreflight(file.arrayBuffer)を開始しない", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    const avifFile = createAvifFile();
    const arrayBufferSpy = vi.spyOn(avifFile, "arrayBuffer");
    selectFiles(input, [avifFile]);

    await waitFor(() => {
      expect(
        screen.getByText("Signature Resizer currently supports JPEG and PNG."),
      ).toBeInTheDocument();
    });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("フォームを空欄のままConvertを押すとバリデーションエラーが表示され、enqueueされない", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createJpegFile(400, 300)]);
    await waitFor(() => expect(screen.getByLabelText(/^Width$/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => {
      expect(screen.getByText("Please enter a value.")).toBeInTheDocument();
    });
    expect(controllable.enqueuedIds).toHaveLength(0);
  });

  it("最大ファイルサイズに0バイトへ丸められる極小値(0.0001)を入力すると、UI側でtoo-smallエラーとして拒否しenqueueされない(Worker側のinvalid-requestへ落とさない)", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createJpegFile(400, 300)]);
    await waitFor(() => expect(screen.getByLabelText(/^Width$/)).toBeInTheDocument());

    await fillForm("200", "100", "0.0001");
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => {
      expect(
        screen.getByText("This value is too small to represent as a whole number of bytes."),
      ).toBeInTheDocument();
    });
    expect(controllable.enqueuedIds).toHaveLength(0);
  });

  it("有効な条件でConvertすると、queued→processing→doneと遷移しチェックリストが表示される", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createJpegFile(400, 300)]);
    await waitFor(() => expect(screen.getByLabelText(/^Width$/)).toBeInTheDocument());

    await fillForm("200", "100", "50");
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));

    controllable.resolve(controllable.enqueuedIds[0], {
      status: "done",
      candidate: {
        jpegBuffer: new ArrayBuffer(4),
        width: 200,
        height: 100,
        quality: 0.8,
        bytes: 40_000,
        mimeType: "image/jpeg",
        upscaled: false,
      },
      encodeCount: 3,
      elapsedMs: 500,
    });

    await waitFor(() => {
      expect(screen.getByText("All conditions were met")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Met")).toHaveLength(4);
  });

  it("送信されるrequestのtargetWidth/targetHeight/maxBytes/fitModeがフォーム入力どおりになる(既定はcontain・背景は白固定)", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createJpegFile(400, 300)]);
    await waitFor(() => expect(screen.getByLabelText(/^Width$/)).toBeInTheDocument());

    await fillForm("140", "60", "20");
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));
    expect(controllable.lastRequest).toMatchObject({
      targetWidth: 140,
      targetHeight: 60,
      maxBytes: 20_000,
      fitMode: "contain",
      background: { r: 255, g: 255, b: 255 },
    });
  });

  it('"Stretch to exact size"を選ぶと、requestのfitModeが"stretch"になる', async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createJpegFile(400, 300)]);
    await waitFor(() => expect(screen.getByLabelText(/^Width$/)).toBeInTheDocument());

    await fillForm("140", "60", "20");
    fireEvent.click(screen.getByLabelText(/Stretch to exact size/));
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));
    expect(controllable.lastRequest).toMatchObject({ fitMode: "stretch" });
  });

  it("unreachableの場合、断定的な失敗表現ではなく専用の説明文とbest-candidateのチェックリストを表示する", async () => {
    render(<SignatureResizerWorkbench locale="en" />);
    const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
    selectFiles(input, [createJpegFile(400, 300)]);
    await waitFor(() => expect(screen.getByLabelText(/^Width$/)).toBeInTheDocument());

    await fillForm("200", "100", "1");
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(controllable.enqueuedIds).toHaveLength(1));

    controllable.resolve(controllable.enqueuedIds[0], {
      status: "unreachable",
      bestCandidate: {
        jpegBuffer: new ArrayBuffer(4),
        width: 200,
        height: 100,
        quality: 0.35,
        bytes: 60_000,
        mimeType: "image/jpeg",
        upscaled: false,
      },
      encodeCount: 9,
      elapsedMs: 900,
    });

    await waitFor(() => {
      expect(screen.getByText("The file size condition could not be met")).toBeInTheDocument();
    });
    // 「原理的に不可能」と断定しない、品質floorの制約であることを説明する文言
    expect(
      screen.getByText(/could not reach this file size within its current JPEG quality range/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Met")).toHaveLength(3); // width/height/format
    expect(screen.getByText("Not met")).toBeInTheDocument(); // size
  });
});
