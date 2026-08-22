import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressWebpBufferToTarget, DEFAULT_WEBP_COMPRESS_LIMITS } from "./image-compress-webp";

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

function fakeBlob(size: number, type = "image/webp"): Blob {
  return {
    size,
    type,
    arrayBuffer: async () => new ArrayBuffer(Math.max(0, size)),
  } as unknown as Blob;
}

let bitmapInstances: StubBitmap[] = [];
let encodeCalls: Array<{ width: number; height: number; quality: number }> = [];
let sizeFn: (width: number, height: number, quality: number) => number;
let mimeOverride: string | null = null;

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
    return fakeBlob(size, mimeOverride ?? opts.type);
  }
}

describe("compressWebpBufferToTarget", () => {
  beforeEach(() => {
    bitmapInstances = [];
    encodeCalls = [];
    mimeOverride = null;
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
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    const outcome = await compressWebpBufferToTarget(new ArrayBuffer(8), 50_000);

    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.width).toBe(2000);
      expect(outcome.height).toBe(1000);
      expect(outcome.webpBuffer.byteLength).toBeLessThanOrEqual(50_000);
      expect(outcome.resizeCount).toBe(0);
      expect(outcome.encodeCount).toBeGreaterThan(0);
      expect(outcome.encodeCount).toBeLessThanOrEqual(DEFAULT_WEBP_COMPRESS_LIMITS.maxTotalEncodes);
    }
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("品質探索の範囲は0.10〜0.98に収まり、1.0は一度も使用されない", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    await compressWebpBufferToTarget(new ArrayBuffer(8), 1);

    expect(encodeCalls.length).toBeGreaterThan(0);
    for (const call of encodeCalls) {
      expect(call.quality).toBeGreaterThanOrEqual(DEFAULT_WEBP_COMPRESS_LIMITS.qualityRange[0]);
      expect(call.quality).toBeLessThanOrEqual(DEFAULT_WEBP_COMPRESS_LIMITS.qualityRange[1]);
      expect(call.quality).not.toBe(1);
    }
  });

  it("元寸法の最低品質でも目標超過の場合、推定寸法へ縮小してから成功する", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    const outcome = await compressWebpBufferToTarget(new ArrayBuffer(8), 20_000);

    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.width).toBeLessThan(2000);
      expect(outcome.height).toBeLessThan(1000);
      expect(outcome.webpBuffer.byteLength).toBeLessThanOrEqual(20_000);
      expect(outcome.resizeCount).toBeGreaterThanOrEqual(1);
      expect(outcome.resizeCount).toBeLessThanOrEqual(
        DEFAULT_WEBP_COMPRESS_LIMITS.maxResizeAttempts,
      );
    }
  });

  it("最小品質・最大リサイズでも目標未達の場合はtarget-unreachableになる", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    const outcome = await compressWebpBufferToTarget(new ArrayBuffer(8), 100);

    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.resizeCount).toBeLessThanOrEqual(
        DEFAULT_WEBP_COMPRESS_LIMITS.maxResizeAttempts,
      );
      expect(outcome.encodeCount).toBeLessThanOrEqual(DEFAULT_WEBP_COMPRESS_LIMITS.maxTotalEncodes);
    }
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("目標以下で最大サイズ(=最高品質)の候補を採用する(非単調でも正しく選ぶ)", async () => {
    sizeFn = (w, h, q) => {
      const base = Math.round(w * h * q * 0.00005);
      if (Math.abs(q - 0.6) < 0.02) return base * 10; // 異常値
      return base;
    };
    const outcome = await compressWebpBufferToTarget(new ArrayBuffer(8), 50_000);

    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.webpBuffer.byteLength).toBeLessThanOrEqual(50_000);
    }
  });

  it("blob.typeがimage/webp以外(MIMEフォールバック)の場合はunsupported-webp-encoderになる", async () => {
    mimeOverride = "image/png";
    sizeFn = () => 1000;
    const outcome = await compressWebpBufferToTarget(new ArrayBuffer(8), 50_000);

    expect(outcome.status).toBe("unsupported-webp-encoder");
    expect(bitmapInstances[0].closed).toBe(true);
  });

  it("createImageBitmapが失敗した場合はerrorステータスを返す", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode failed"))),
    );
    const outcome = await compressWebpBufferToTarget(new ArrayBuffer(8), 50_000);

    expect(outcome).toEqual({ status: "error", message: "decode failed" });
  });

  it("宣言寸法と実寸法(bitmap.width/height)が一致する場合はそのまま処理する", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    const outcome = await compressWebpBufferToTarget(
      new ArrayBuffer(8),
      50_000,
      DEFAULT_WEBP_COMPRESS_LIMITS,
      undefined,
      { width: 2000, height: 1000 },
    );
    expect(outcome.status).toBe("done");
  });

  it("幅高さの入れ替わりは一致とみなす", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    const outcome = await compressWebpBufferToTarget(
      new ArrayBuffer(8),
      50_000,
      DEFAULT_WEBP_COMPRESS_LIMITS,
      undefined,
      { width: 1000, height: 2000 }, // bitmapは2000x1000、宣言は1000x2000(入れ替わり)
    );
    expect(outcome.status).toBe("done");
  });

  it("宣言寸法と実寸法が一致しない場合はdimension-mismatchとして拒否し、bitmap.closeを呼ぶ", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    const outcome = await compressWebpBufferToTarget(
      new ArrayBuffer(8),
      50_000,
      DEFAULT_WEBP_COMPRESS_LIMITS,
      undefined,
      { width: 4000, height: 4000 },
    );
    expect(outcome).toEqual({ status: "dimension-mismatch" });
    expect(bitmapInstances[0].closed).toBe(true);
    expect(encodeCalls.length).toBe(0);
  });

  it("処理時間の上限を超過すると即座に打ち切られる(cancel/timeoutの安全弁)", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    const outcome = await compressWebpBufferToTarget(new ArrayBuffer(8), 1, {
      ...DEFAULT_WEBP_COMPRESS_LIMITS,
      timeBudgetMs: -1,
    });

    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.encodeCount).toBe(0);
    }
  });

  it("縮小後の寸法が最小辺(320px)を下回らない", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    await compressWebpBufferToTarget(new ArrayBuffer(8), 1);

    for (const call of encodeCalls) {
      expect(Math.min(call.width, call.height)).toBeGreaterThanOrEqual(
        DEFAULT_WEBP_COMPRESS_LIMITS.minDimension - 1,
      );
    }
  });

  it("達成不能な場合でも合計エンコード回数は上限を超えない", async () => {
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.05);
    await compressWebpBufferToTarget(new ArrayBuffer(8), 1);

    expect(encodeCalls.length).toBeLessThanOrEqual(DEFAULT_WEBP_COMPRESS_LIMITS.maxTotalEncodes);
  });

  it("1件目が失敗(error)しても、モジュール自体は次の呼び出しで正常に動作する", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode failed"))),
    );
    const first = await compressWebpBufferToTarget(new ArrayBuffer(8), 50_000);
    expect(first.status).toBe("error");

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(new StubBitmap(2000, 1000))),
    );
    sizeFn = (w, h, q) => Math.round(w * h * q * 0.00005);
    const second = await compressWebpBufferToTarget(new ArrayBuffer(8), 50_000);
    expect(second.status).toBe("done");
  });
});
