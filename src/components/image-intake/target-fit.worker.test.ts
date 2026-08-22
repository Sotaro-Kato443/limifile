import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import { buildConditionChecklist } from "./target-fit-condition-check";
import { targetFitBufferToJpeg } from "./target-fit.worker";
import type { TargetFitLimits } from "./target-fit-types";

class StubBitmap {
  width: number;
  height: number;
  closed = false;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  close(): void {
    this.closed = true;
  }
}

/** SOI+SOF0のみを持つ最小限のJPEGバイト列を組み立てる(image-header-dimensions.tsのreadJpegDimensions参照)。
 * totalLengthに満たない分は末尾を0埋めして伸ばす(blob.sizeとarrayBuffer().byteLengthを一致させるため)。 */
function buildFakeJpegBytes(width: number, height: number, totalLength: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(11, totalLength));
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

/** SOIマーカーを持たない、意図的にJPEGとして解析不能なバイト列 */
const UNPARSEABLE_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

function fakeBlob(bytes: Uint8Array, type: string): Blob {
  return {
    size: bytes.length,
    type,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Blob;
}

let bitmapInstances: StubBitmap[] = [];
let canvasInstances: StubOffscreenCanvas[] = [];
let fillCalls: Array<{ fillStyle: string; rect: [number, number, number, number] }> = [];
let drawImageCalls: Array<[number, number, number, number]> = [];
let encodeCalls: Array<{ quality: number }> = [];
/** quality→出力バイト列の総長。既定は単調増加(qualityが高いほど大きい)。テストごとに差し替える */
let bytesForQuality: (quality: number) => number = (quality) => Math.round(quality * 20000);
/** quality→convertToBlobが返すMIME型のオーバーライド。nullなら要求どおりimage/jpegを返す */
let mimeForQuality: (quality: number) => string | null = () => null;
/** quality→出力JPEGへ埋め込むheader寸法。既定はcanvas実寸法と一致(自己無矛盾な模擬)。
 * nullを返すとSOIマーカーの無い解析不能なバイト列になる */
let headerDimensionsForQuality: (
  quality: number,
  canvasWidth: number,
  canvasHeight: number,
) => { width: number; height: number } | null = (_quality, canvasWidth, canvasHeight) => ({
  width: canvasWidth,
  height: canvasHeight,
});

class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    canvasInstances.push(this);
  }
  getContext() {
    const ctx = {
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillRect: (x: number, y: number, w: number, h: number) => {
        fillCalls.push({ fillStyle: ctx.fillStyle, rect: [x, y, w, h] });
      },
      drawImage: vi.fn((_bitmap: unknown, dx: number, dy: number, dw: number, dh: number) => {
        drawImageCalls.push([dx, dy, dw, dh]);
      }),
    };
    return ctx;
  }
  async convertToBlob(opts: { type: string; quality: number }): Promise<Blob> {
    encodeCalls.push({ quality: opts.quality });
    const mimeType = mimeForQuality(opts.quality) ?? opts.type;
    const dims = headerDimensionsForQuality(opts.quality, this.width, this.height);
    const contentBytes = dims
      ? buildFakeJpegBytes(dims.width, dims.height, bytesForQuality(opts.quality))
      : UNPARSEABLE_BYTES;
    return fakeBlob(contentBytes, mimeType);
  }
}

const FAST_LIMITS: TargetFitLimits = {
  qualityRange: [0.35, 0.92],
  maxQualityIterations: 8,
  timeBudgetMs: 15000,
};

function defaultRequest(overrides: Partial<Parameters<typeof targetFitBufferToJpeg>[2]> = {}) {
  return {
    targetWidth: 200,
    targetHeight: 100,
    maxBytes: 100_000,
    fitMode: "contain" as const,
    background: DEFAULT_RASTER_BACKGROUND,
    ...overrides,
  };
}

describe("targetFitBufferToJpeg", () => {
  beforeEach(() => {
    bitmapInstances = [];
    canvasInstances = [];
    fillCalls = [];
    drawImageCalls = [];
    encodeCalls = [];
    bytesForQuality = (quality) => Math.round(quality * 20000);
    mimeForQuality = () => null;
    headerDimensionsForQuality = (_quality, canvasWidth, canvasHeight) => ({
      width: canvasWidth,
      height: canvasHeight,
    });
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const bitmap = new StubBitmap(800, 400);
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("canvasを1回だけ作成し、drawImageも1回だけ呼ぶ(draw-once, encode-many)", async () => {
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome.status).toBe("done");
    expect(canvasInstances).toHaveLength(1);
    expect(drawImageCalls).toHaveLength(1);
    // floor probe + qualityHi probe(+条件次第で二分探索)が描画とは独立に複数回行われている
    expect(encodeCalls.length).toBeGreaterThan(1);
  });

  it("containモードでは、背景色をfillRectしてからcomputeContainLayoutの位置にdrawImageする", async () => {
    await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      background: { r: 10, g: 20, b: 30 },
    });
    expect(fillCalls[0].fillStyle).toBe("rgb(10, 20, 30)");
    expect(fillCalls[0].rect).toEqual([0, 0, 200, 100]);
    // source 800x400 (aspect 2:1) を target 200x100 (aspect 2:1) へ: ぴったり収まり余白なし
    expect(drawImageCalls[0]).toEqual([0, 0, 200, 100]);
  });

  it("stretchモードでは、常にtargetの全面(dx=dy=0)へdrawImageする", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const bitmap = new StubBitmap(300, 900); // アスペクト比がtargetと異なる
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
    await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      fitMode: "stretch",
    });
    expect(drawImageCalls[0]).toEqual([0, 0, 200, 100]);
  });

  it("qualityHiがmaxBytes以下に収まる場合、それ自体をdoneとして採用し二分探索は行わない", async () => {
    // floor(0.35*20000=7000)・qualityHi(0.92*20000=18400)ともmaxBytes(50000)以下
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      maxBytes: 50_000,
    });
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.candidate.quality).toBe(0.92);
    }
    // floor probe(1) + qualityHi probe(1) = 2回のみ。二分探索は一切行われていない
    expect(encodeCalls).toEqual([{ quality: 0.35 }, { quality: 0.92 }]);
  });

  it("qualityHiがmaxBytesを超える場合のみ、二分探索でより低いqualityを探す", async () => {
    // size = quality * 20000。maxBytes=15000 → quality<=0.75が条件。qualityHi(18400)は超過する
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      maxBytes: 15000,
    });
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.candidate.bytes).toBeLessThanOrEqual(15000);
      // 二分探索が0.75付近へ十分収束していること(floor 0.35は使われていないはず)
      expect(outcome.candidate.quality).toBeGreaterThan(0.35);
      expect(outcome.candidate.quality).toBeLessThan(0.92);
    }
    // floor probe + qualityHi probe + 二分探索の複数回、の合計で3回より多いはず
    expect(encodeCalls.length).toBeGreaterThan(2);
    expect(encodeCalls).toContainEqual({ quality: 0.92 });
  });

  it("floor quality(0.35)でもmaxBytesに収まらない場合、smallestSeenをbestCandidateとしてunreachableを返す", async () => {
    // floor(0.35)でも 0.35*20000=7000 > maxBytes(1000)
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      maxBytes: 1000,
    });
    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      // 全候補中で最小のbytesを持つ候補(quality最小=floor付近)が採用される
      expect(outcome.bestCandidate.bytes).toBeGreaterThan(1000);
      expect(outcome.bestCandidate.width).toBe(200);
      expect(outcome.bestCandidate.height).toBe(100);
    }
  });

  it("quality→bytesが単調でなくても、maxBytes以下を満たした中で最大qualityのcandidateを採用する", async () => {
    // 非単調: quality=0.9で意図的に極端に小さいbytesを返す「ノイズ」候補を混ぜる。
    // 二分探索のlo/hiだけを信じるとこのノイズに惑わされ得るが、bestFitは
    // 「maxBytes以下を満たした中でquality最大」を全候補から独立に追跡するため、
    // 最終的により高いqualityの妥当な候補を選べることを確認する。
    bytesForQuality = (quality) => {
      if (Math.abs(quality - 0.9) < 0.001) return 500; // ノイズ: 高qualityなのに極小
      return Math.round(quality * 20000);
    };
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      maxBytes: 15000,
    });
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.candidate.bytes).toBeLessThanOrEqual(15000);
    }
  });

  it("実測JPEG headerの寸法がtargetと異なる場合、doneにもunreachableにもならずunsupported-encoderを返す", async () => {
    // エンコーダが実際にはcanvasのtargetWidth/targetHeight(200×100)と異なる寸法を
    // header上に記録したという想定(ブラウザ実装差・不具合等の可能性を模す)。
    // target-fit.worker.ts自身のdone/unreachable判定がこの食い違いを検出できず、
    // bestFitの有無だけでdoneにしてしまうと、UI上部の「全条件を満たした」という文言と
    // checklistのWidth/Height Not met表示が矛盾する。ここではそれを許さず、
    // 既存のunsupported-encoder(寸法不一致もencoder/output verification failureとして扱う)
    // へ倒すことを確認する。
    headerDimensionsForQuality = () => ({ width: 321, height: 654 });
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome).toEqual({ status: "unsupported-encoder" });
  });

  it("生成JPEGバイト列のheaderが解析不能な場合、doneでもunreachableでもなくerrorを返す", async () => {
    headerDimensionsForQuality = () => null; // SOIマーカー無しの解析不能なバイト列を返す
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome.status).toBe("error");
  });

  it("candidate.bytesはblob.sizeではなく、実際に読み取ったjpegBuffer.byteLengthを最終値とする", async () => {
    // blob.size(bytesForQuality)とarrayBuffer()の実バイト長を意図的に食い違わせ、
    // 最終的にjpegBuffer.byteLength側が使われていることを検証する。
    const REPORTED_SIZE = 12345;
    const ACTUAL_BYTES = buildFakeJpegBytes(200, 100, 999); // 999 !== REPORTED_SIZE
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    class MismatchedCanvas extends StubOffscreenCanvas {
      async convertToBlob(opts: { type: string; quality: number }): Promise<Blob> {
        encodeCalls.push({ quality: opts.quality });
        return {
          size: REPORTED_SIZE,
          type: opts.type,
          arrayBuffer: async () =>
            ACTUAL_BYTES.buffer.slice(
              ACTUAL_BYTES.byteOffset,
              ACTUAL_BYTES.byteOffset + ACTUAL_BYTES.byteLength,
            ),
        } as unknown as Blob;
      }
    }
    vi.stubGlobal("OffscreenCanvas", MismatchedCanvas);

    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.candidate.bytes).toBe(999);
      expect(outcome.candidate.bytes).not.toBe(REPORTED_SIZE);
    }
  });

  it("blob.sizeはmaxBytesを超えるが実測jpegBuffer.byteLengthはmaxBytes以下の場合、doneを返す(最終statusはbyteLength側に従う)", async () => {
    // 探索中は常にblob.size(REPORTED_SIZE=200000)がmaxBytesを超えるためbestFitには一切
    // 採用されない(smallestSeenのみ)。しかし実際に読み取ったjpegBuffer.byteLength(500)は
    // maxBytes以下であり、最終statusはこちらに従ってdoneになるべき。
    const REPORTED_SIZE = 200_000;
    const ACTUAL_BYTES = buildFakeJpegBytes(200, 100, 500);
    class OverReportedCanvas extends StubOffscreenCanvas {
      async convertToBlob(opts: { type: string; quality: number }): Promise<Blob> {
        encodeCalls.push({ quality: opts.quality });
        return {
          size: REPORTED_SIZE,
          type: opts.type,
          arrayBuffer: async () =>
            ACTUAL_BYTES.buffer.slice(
              ACTUAL_BYTES.byteOffset,
              ACTUAL_BYTES.byteOffset + ACTUAL_BYTES.byteLength,
            ),
        } as unknown as Blob;
      }
    }
    vi.stubGlobal("OffscreenCanvas", OverReportedCanvas);

    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      maxBytes: 100_000,
    });
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.candidate.bytes).toBe(500);
    }
  });

  it("blob.sizeはmaxBytes以下だが実測jpegBuffer.byteLengthはmaxBytesを超える場合、unreachableを返す(最終statusはbyteLength側に従う)", async () => {
    // 探索中は常にblob.size(REPORTED_SIZE=500)がmaxBytes以下のためbestFitに採用され、
    // qualityHiがそのままbestFitになり二分探索は行われない。しかし実際に読み取った
    // jpegBuffer.byteLength(200000)はmaxBytesを超えており、最終statusはこちらに従って
    // unreachableになるべき。
    const REPORTED_SIZE = 500;
    const ACTUAL_BYTES = buildFakeJpegBytes(200, 100, 200_000);
    class UnderReportedCanvas extends StubOffscreenCanvas {
      async convertToBlob(opts: { type: string; quality: number }): Promise<Blob> {
        encodeCalls.push({ quality: opts.quality });
        return {
          size: REPORTED_SIZE,
          type: opts.type,
          arrayBuffer: async () =>
            ACTUAL_BYTES.buffer.slice(
              ACTUAL_BYTES.byteOffset,
              ACTUAL_BYTES.byteOffset + ACTUAL_BYTES.byteLength,
            ),
        } as unknown as Blob;
      }
    }
    vi.stubGlobal("OffscreenCanvas", UnderReportedCanvas);

    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      maxBytes: 100_000,
    });
    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.bestCandidate.bytes).toBe(200_000);
    }
    // qualityHiがそのままbestFitとしてmaxBytes以下を満たしたと判断され、二分探索は行われない
    expect(encodeCalls).toEqual([{ quality: 0.35 }, { quality: 0.92 }]);
  });

  it("正常なdoneの場合、buildConditionChecklistの全4項目がok:trueになる", async () => {
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      const checklist = buildConditionChecklist(outcome.candidate, {
        ...defaultRequest(),
      });
      expect(checklist.width.ok).toBe(true);
      expect(checklist.height.ok).toBe(true);
      expect(checklist.size.ok).toBe(true);
      expect(checklist.format.ok).toBe(true);
    }
  });

  it("正常なunreachableの場合、buildConditionChecklistはwidth/height/formatがok:trueでsizeのみok:falseになる", async () => {
    // floor qualityでもmaxBytesに収まらない典型ケース
    const request = { ...defaultRequest(), maxBytes: 1000 };
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", request);
    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      const checklist = buildConditionChecklist(outcome.bestCandidate, request);
      expect(checklist.width.ok).toBe(true);
      expect(checklist.height.ok).toBe(true);
      expect(checklist.format.ok).toBe(true);
      expect(checklist.size.ok).toBe(false);
    }
  });

  it("floorはJPEGを返すがqualityHiがPNGを返す場合、即座にunsupported-encoderを返し二分探索を開始しない", async () => {
    // floorのみ正しくJPEGを返し、qualityHi以降はPNGへフォールバックしたという想定。
    // qualityHiのbytesはfloorより小さい値にしておき、MIME検証が無ければ誤って
    // bestFit/smallestSeenに採用され、binary searchのlo/hi判定にも使われてしまうことを示す。
    mimeForQuality = (quality) => (quality === 0.35 ? null : "image/png");
    bytesForQuality = (quality) => (quality === 0.35 ? 7000 : 100); // floor以外は極小サイズ
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      maxBytes: 50_000,
    });
    expect(outcome).toEqual({ status: "unsupported-encoder" });
    // floor probe(1) + qualityHi probe(1) = 2回のみ。二分探索は一切行われていない
    expect(encodeCalls).toEqual([{ quality: 0.35 }, { quality: 0.92 }]);
  });

  it("二分探索中のprobeがimage/jpeg以外を返した場合も、即座にunsupported-encoderを返しそのbytesをlo/hi判定へ使わない", async () => {
    // floor・qualityHiは正しくJPEGを返すが、qualityHiはmaxBytesを超えるため二分探索へ入る。
    // 二分探索1回目のprobeでPNGへフォールバックしたという想定。
    mimeForQuality = (quality) => (quality === 0.35 || quality === 0.92 ? null : "image/png");
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", {
      ...defaultRequest(),
      maxBytes: 15000, // qualityHi(18400)は超過するため二分探索へ入る
    });
    expect(outcome).toEqual({ status: "unsupported-encoder" });
    // floor + qualityHi + 二分探索1回目 = 3回で打ち切られている
    expect(encodeCalls).toHaveLength(3);
  });

  it("decode後の実寸法がDECODE_SAFETY_LIMITSを超える場合、unsafe-dimensionsを返しencodeは行わない", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const bitmap = new StubBitmap(20000, 100);
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome).toEqual({ status: "unsafe-dimensions" });
    expect(bitmapInstances[0].closed).toBe(true);
    expect(encodeCalls).toHaveLength(0);
  });

  it("floor probeでblob.typeがimage/jpeg以外の場合、即座にunsupported-encoderを返し以降のencodeを行わない(fail fast)", async () => {
    mimeForQuality = () => "image/png";
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome).toEqual({ status: "unsupported-encoder" });
    expect(encodeCalls).toHaveLength(1); // floor probeの1回だけで打ち切られている
  });

  it("sourceがtargetより小さい場合、アップスケールしcandidate.upscaled=trueになる", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const bitmap = new StubBitmap(50, 25);
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.candidate.upscaled).toBe(true);
    }
  });

  it("sourceがtargetより大きい場合、upscaled=falseになる", async () => {
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.candidate.upscaled).toBe(false);
    }
  });

  it("createImageBitmapが失敗した場合はerrorを返す", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode failed"))),
    );
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest());
    expect(outcome).toEqual({ status: "error", message: "decode failed" });
  });

  it("デコードが時間予算を超過するとtimeoutを返す", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => new Promise(() => {})),
    );
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "png", defaultRequest(), {
      ...FAST_LIMITS,
      timeBudgetMs: 10,
    });
    expect(outcome).toEqual({ status: "timeout" });
  });

  it("JPEG入力でも同様に処理できる", async () => {
    const outcome = await targetFitBufferToJpeg(new ArrayBuffer(8), "jpeg", defaultRequest());
    expect(outcome.status).toBe("done");
  });
});
