import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressJpegBufferToTarget, DEFAULT_COMPRESS_LIMITS } from "./image-compress.worker";

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

function fakeBlob(size: number): Blob {
  return {
    size,
    type: "image/jpeg",
    arrayBuffer: async () => new ArrayBuffer(Math.max(0, size)),
  } as unknown as Blob;
}

let bitmapInstances: StubBitmap[] = [];
let encodeCalls: Array<{ width: number; height: number; quality: number }> = [];
let sizeFn: (width: number, height: number, quality: number) => number;

class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return { drawImage: vi.fn() };
  }
  async convertToBlob(opts: { type: string; quality: number }): Promise<Blob> {
    const size = sizeFn(this.width, this.height, opts.quality);
    encodeCalls.push({ width: this.width, height: this.height, quality: opts.quality });
    return fakeBlob(size);
  }
}

describe("compressJpegBufferToTarget", () => {
  beforeEach(() => {
    bitmapInstances = [];
    encodeCalls = [];
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn((...args: unknown[]) => {
        void args;
        const bitmap = new StubBitmap(2000, 1000);
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("品質探索のみで目標以下に到達した場合、寸法は変更されない", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005); // 2000x1000, q=0.5 -> 50,000B
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 50_000);

    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.width).toBe(2000);
      expect(outcome.height).toBe(1000);
      expect(outcome.jpegBuffer.byteLength).toBeLessThanOrEqual(50_000);
      expect(outcome.resizeCount).toBe(0);
      expect(outcome.encodeCount).toBeGreaterThan(0);
      expect(outcome.encodeCount).toBeLessThanOrEqual(DEFAULT_COMPRESS_LIMITS.maxTotalEncodes);
    }
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("元寸法の最低品質でも目標超過の場合、推定寸法へ縮小してから成功する", async () => {
    // 2000x1000(=2,000,000px)、q=0.35でも 2,000,000*0.35*0.05=35,000B > target(20,000B) のため必ず縮小が必要
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 20_000);

    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.width).toBeLessThan(2000);
      expect(outcome.height).toBeLessThan(1000);
      expect(outcome.jpegBuffer.byteLength).toBeLessThanOrEqual(20_000);
      expect(outcome.resizeCount).toBeGreaterThanOrEqual(1);
      expect(outcome.resizeCount).toBeLessThanOrEqual(DEFAULT_COMPRESS_LIMITS.maxResizeAttempts);
    }
  });

  it("固定0.85倍の反復縮小ではなく、比率推定で一度に縮小する(最初のリサイズが極端に小さすぎない)", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 20_000);

    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      // 0.85倍を1回だけ適用した場合の幅(1700)よりも、比率推定によるジャンプの方が小さいはずだが、
      // 極端な過剰縮小(数段階を要する)にはなっていないことを確認する
      expect(outcome.width).toBeGreaterThan(DEFAULT_COMPRESS_LIMITS.minDimension);
    }
  });

  it("最小寸法まで縮小しても達成できない場合はtarget-unreachableになる", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 100);

    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.resizeCount).toBeLessThanOrEqual(DEFAULT_COMPRESS_LIMITS.maxResizeAttempts);
      expect(outcome.encodeCount).toBeLessThanOrEqual(DEFAULT_COMPRESS_LIMITS.maxTotalEncodes);
    }
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("段階間の予算配分が偏らず、リサイズ試行回数の上限(3回)まで実際に到達する(回帰テスト)", async () => {
    // 品質探索に固定でmaxQualityIterationsPerStage(6回)を毎段階使うと、
    // 「元寸法探索」+「リサイズ1回目」だけでmaxTotalEncodes(12回)を使い切ってしまい、
    // resizeCountが1で頭打ちになる(=maxResizeAttempts=3が実質使われない)バグが過去にあった。
    // 実写真に近い寸法比(4032x3024)+一定のオーバーヘッドを持つサイズ関数(縮小しても
    // ある値を下回らない=実JPEGの非線形な圧縮特性を模した非"きれいな"モデル)で、
    // 3回のリサイズを使い切っても届かない(unreachable)ケースを検証する。
    bitmapInstances = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const bitmap = new StubBitmap(4032, 3024);
        bitmapInstances.push(bitmap);
        return Promise.resolve(bitmap);
      }),
    );
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00001) + 50;

    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 55);

    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.resizeCount).toBe(DEFAULT_COMPRESS_LIMITS.maxResizeAttempts);
      expect(outcome.encodeCount).toBeLessThanOrEqual(DEFAULT_COMPRESS_LIMITS.maxTotalEncodes);
    }
  });

  it("達成不能な場合でも合計エンコード回数は上限(12回)を超えない", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    await compressJpegBufferToTarget(new ArrayBuffer(8), 1);

    expect(encodeCalls.length).toBeLessThanOrEqual(DEFAULT_COMPRESS_LIMITS.maxTotalEncodes);
  });

  it("リサイズ回数は上限(3回)を超えない", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 1);

    if (outcome.status === "unreachable") {
      expect(outcome.resizeCount).toBeLessThanOrEqual(3);
    }
  });

  it("縮小後の寸法が最小辺(320px)を下回らない", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    await compressJpegBufferToTarget(new ArrayBuffer(8), 1);

    for (const call of encodeCalls) {
      expect(Math.min(call.width, call.height)).toBeGreaterThanOrEqual(
        DEFAULT_COMPRESS_LIMITS.minDimension - 1,
      );
    }
  });

  it("エンコード結果が品質に対して非単調でも、size<=targetBytesの候補のみを正しく採用する", async () => {
    // 意図的に非単調: quality 0.6付近だけ異常に大きいサイズを返す
    sizeFn = (w, h, q) => {
      const base = Math.round(w * h * q * 0.00005);
      if (Math.abs(q - 0.6) < 0.02) return base * 10; // 異常値
      return base;
    };
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 50_000);

    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.jpegBuffer.byteLength).toBeLessThanOrEqual(50_000);
    }
  });

  it("createImageBitmapが失敗した場合はerrorステータスを返す", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode failed"))),
    );
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 50_000);

    expect(outcome).toEqual({ status: "error", message: "decode failed" });
  });

  it("declaredDimensionsを省略した場合は寸法照合を行わない(既存呼び出しと完全互換)", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    // ビットマップ(2000x1000)と全く異なる宣言寸法があっても、引数を渡さなければ照合しない
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 50_000);
    expect(outcome.status).toBe("done");
  });

  it("宣言寸法と実寸法(bitmap.width/height)が一致する場合はそのまま処理する", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    const outcome = await compressJpegBufferToTarget(
      new ArrayBuffer(8),
      50_000,
      DEFAULT_COMPRESS_LIMITS,
      undefined,
      { width: 2000, height: 1000 },
    );
    expect(outcome.status).toBe("done");
  });

  it("EXIF Orientationによる幅高さの入れ替わりは一致とみなす", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    const outcome = await compressJpegBufferToTarget(
      new ArrayBuffer(8),
      50_000,
      DEFAULT_COMPRESS_LIMITS,
      undefined,
      { width: 1000, height: 2000 }, // bitmapは2000x1000、宣言は1000x2000(入れ替わり)
    );
    expect(outcome.status).toBe("done");
  });

  it("宣言寸法と実寸法が一致しない場合はdimension-mismatchとして拒否し、bitmap.closeを呼ぶ", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    const outcome = await compressJpegBufferToTarget(
      new ArrayBuffer(8),
      50_000,
      DEFAULT_COMPRESS_LIMITS,
      undefined,
      { width: 4000, height: 4000 }, // bitmapは2000x1000で全く一致しない
    );
    expect(outcome).toEqual({ status: "dimension-mismatch" });
    expect(bitmapInstances[0].closed).toBe(true);
    expect(encodeCalls.length).toBe(0); // OffscreenCanvas(エンコード)は一切呼ばれない
  });

  it("処理時間の上限を設定でき、超過すると打ち切られる", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    const outcome = await compressJpegBufferToTarget(new ArrayBuffer(8), 1, {
      ...DEFAULT_COMPRESS_LIMITS,
      timeBudgetMs: -1, // 常に超過扱いにして即座に打ち切られることを確認
    });

    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.encodeCount).toBe(0);
    }
  });
});
