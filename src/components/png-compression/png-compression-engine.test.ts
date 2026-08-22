import { describe, expect, it, vi } from "vitest";
import {
  estimateNextScale,
  runPngCompressionSearch,
  selectBestCandidate,
  stratifiedSample,
  validateUpngOutputBytes,
} from "./png-compression-engine";
import { DEFAULT_PNG_COMPRESSION_LIMITS } from "./png-compression-types";
import type { UpngEncodeFunction } from "./png-compression-types";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}
function chunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}
function ihdrData(width: number, height: number): number[] {
  return [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0];
}
function buildValidPng(
  width: number,
  height: number,
  idatBytes: number[] = [1, 2, 3],
): ArrayBuffer {
  const bytes = new Uint8Array([
    ...PNG_SIGNATURE,
    ...chunk("IHDR", ihdrData(width, height)),
    ...chunk("IDAT", idatBytes),
    ...chunk("IEND", []),
  ]);
  return bytes.buffer;
}

describe("validateUpngOutputBytes", () => {
  it("正常なPNGバイト列は検証を通過する", () => {
    expect(validateUpngOutputBytes(buildValidPng(10, 10), 10, 10)).toBe(true);
  });

  it("byteLength=0は拒否する", () => {
    expect(validateUpngOutputBytes(new ArrayBuffer(0), 10, 10)).toBe(false);
  });

  it("PNG signatureが不正な場合は拒否する", () => {
    const bad = new Uint8Array(buildValidPng(10, 10));
    bad[0] = 0;
    expect(validateUpngOutputBytes(bad.buffer, 10, 10)).toBe(false);
  });

  it("期待したwidth/heightと異なる場合は拒否する", () => {
    expect(validateUpngOutputBytes(buildValidPng(10, 10), 20, 20)).toBe(false);
  });

  it("acTLを含む(APNG相当の)出力は拒否する", () => {
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...chunk("IHDR", ihdrData(10, 10)),
      ...chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]),
      ...chunk("IDAT", [1, 2]),
      ...chunk("IEND", []),
    ]);
    expect(validateUpngOutputBytes(bytes.buffer, 10, 10)).toBe(false);
  });

  it("IEND後に余分なデータがある場合は拒否する", () => {
    const valid = new Uint8Array(buildValidPng(10, 10));
    const withTrailing = new Uint8Array(valid.length + 4);
    withTrailing.set(valid);
    expect(validateUpngOutputBytes(withTrailing.buffer, 10, 10)).toBe(false);
  });
});

describe("selectBestCandidate", () => {
  function candidate(overrides: Partial<Parameters<typeof selectBestCandidate>[0][number]>) {
    return {
      pngBuffer: new ArrayBuffer(0),
      outputBytes: 1000,
      width: 100,
      height: 100,
      colorCount: 256,
      meetsTarget: false,
      ...overrides,
    };
  }

  it("target以下の候補を、未達候補より優先する", () => {
    const a = candidate({ meetsTarget: false, outputBytes: 500 });
    const b = candidate({ meetsTarget: true, outputBytes: 900 });
    expect(selectBestCandidate([a, b], 1000)).toBe(b);
  });

  it("target以下同士では寸法が大きい方を優先する", () => {
    const a = candidate({ meetsTarget: true, width: 100, height: 100, outputBytes: 500 });
    const b = candidate({ meetsTarget: true, width: 200, height: 200, outputBytes: 500 });
    expect(selectBestCandidate([a, b], 1000)).toBe(b);
  });

  it("同寸法なら色数が多い方を優先する", () => {
    const a = candidate({ meetsTarget: true, colorCount: 16, outputBytes: 500 });
    const b = candidate({ meetsTarget: true, colorCount: 64, outputBytes: 500 });
    expect(selectBestCandidate([a, b], 1000)).toBe(b);
  });

  it("同色数ならtargetに近い方を優先する", () => {
    const a = candidate({ meetsTarget: true, outputBytes: 400 });
    const b = candidate({ meetsTarget: true, outputBytes: 900 });
    expect(selectBestCandidate([a, b], 1000)).toBe(b);
  });

  it("全条件同一ならファイルサイズが大きい方を優先する(target以下で最も情報量を残すため)", () => {
    const a = candidate({ meetsTarget: true, outputBytes: 500 });
    const b = candidate({ meetsTarget: true, outputBytes: 700 });
    // 両方targetから同距離になるよう調整(target=600の場合、|500-600|=100, |700-600|=100)
    expect(selectBestCandidate([a, b], 600)).toBe(b);
  });

  it("候補が空ならnullを返す", () => {
    expect(selectBestCandidate([], 1000)).toBeNull();
  });
});

describe("stratifiedSample", () => {
  const SMALL_TIER = [256, 192, 128, 96, 64, 48, 32, 24, 16, 12, 8, 6, 4, 2];
  const MEDIUM_TIER = [256, 128, 64, 32, 16, 8, 4, 2];
  const LARGE_TIER = [128, 32, 8, 2];

  function isDescending(list: number[]): boolean {
    for (let i = 1; i < list.length; i++) {
      if (list[i] >= list[i - 1]) return false;
    }
    return true;
  }
  function hasNoDuplicates(list: number[]): boolean {
    return new Set(list).size === list.length;
  }
  function isSubsetOf(list: number[], source: readonly number[]): boolean {
    return list.every((v) => source.includes(v));
  }

  it("budget=0なら空配列を返す", () => {
    expect(stratifiedSample(SMALL_TIER, 0)).toEqual([]);
  });

  it("budget=1なら最小色数だけを返す(target到達可能性を優先)", () => {
    expect(stratifiedSample(SMALL_TIER, 1)).toEqual([2]);
    expect(stratifiedSample(MEDIUM_TIER, 1)).toEqual([2]);
    expect(stratifiedSample(LARGE_TIER, 1)).toEqual([2]);
  });

  it("budget=2なら最大色数と最小色数のみを返す", () => {
    expect(stratifiedSample(SMALL_TIER, 2)).toEqual([256, 2]);
  });

  it("budget=3なら最大・中間1つ・最小を返す", () => {
    const result = stratifiedSample(SMALL_TIER, 3);
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result[0]).toBe(256);
    expect(result[result.length - 1]).toBe(2);
  });

  it("budgetがlist長以上ならそのまま全件返す", () => {
    expect(stratifiedSample([256, 128, 64], 10)).toEqual([256, 128, 64]);
  });

  it.each([
    ["small", SMALL_TIER],
    ["medium", MEDIUM_TIER],
    ["large", LARGE_TIER],
  ] as const)(
    "%sティアの実際の候補で、budget=1〜listの全長についてlength<=budget・先頭末尾を含む・降順・重複なしを保つ",
    (_label, tier) => {
      for (let budget = 1; budget <= tier.length + 2; budget++) {
        const result = stratifiedSample(tier, budget);
        expect(result.length).toBeLessThanOrEqual(budget);
        expect(isDescending(result)).toBe(true);
        expect(hasNoDuplicates(result)).toBe(true);
        expect(isSubsetOf(result, tier)).toBe(true);
        if (budget >= 2 && tier.length > budget) {
          expect(result[0]).toBe(tier[0]);
          expect(result[result.length - 1]).toBe(tier[tier.length - 1]);
        }
      }
    },
  );
});

describe("estimateNextScale", () => {
  it("推定scaleを0.25〜0.90へclampする(下限)", () => {
    const result = estimateNextScale(1, 1_000_000_000, 1000, 1000);
    expect(result).not.toBeNull();
    expect(result!.scale).toBeCloseTo(0.25, 5);
  });

  it("推定scaleを0.25〜0.90へclampする(上限)", () => {
    const result = estimateNextScale(999, 1000, 1000, 1000);
    expect(result).not.toBeNull();
    expect(result!.scale).toBeLessThanOrEqual(0.9);
  });

  it("アスペクト比を維持する", () => {
    const result = estimateNextScale(1000, 4000, 1000, 500, DEFAULT_PNG_COMPRESSION_LIMITS);
    expect(result).not.toBeNull();
    expect(result!.width / result!.height).toBeCloseTo(1000 / 500, 1);
  });

  it("同じ寸法になる場合はnullを返す(同じ寸法を繰り返さない)", () => {
    const result = estimateNextScale(1000, 1000, 10, 10, {
      ...DEFAULT_PNG_COMPRESSION_LIMITS,
      minScale: 0.99,
      maxScale: 0.99,
    });
    // 10*0.99=9.9 -> round(9.9)=10、つまり同じ寸法になるためnull
    expect(result).toBeNull();
  });

  it("変化が小さすぎる場合はnullを返す", () => {
    const result = estimateNextScale(990, 1000, 1000, 1000, {
      ...DEFAULT_PNG_COMPRESSION_LIMITS,
      minMeaningfulScaleDelta: 0.5,
    });
    expect(result).toBeNull();
  });

  it("拡大は行わない(scaleは常に1.0未満)", () => {
    const result = estimateNextScale(1_000_000, 1, 1000, 1000);
    expect(result).not.toBeNull();
    expect(result!.scale).toBeLessThan(1);
  });
});

function makeFakeEncode(
  sizeForColorCount: Record<number, number>,
  onCall?: (colorCount: number) => void,
): UpngEncodeFunction {
  return (_imgs, w, h, cnum) => {
    onCall?.(cnum);
    const bytes = sizeForColorCount[cnum] ?? 100;
    return buildValidPng(w, h, new Array(Math.max(1, bytes - 60)).fill(1));
  };
}

describe("runPngCompressionSearch", () => {
  it("フルサイズの候補でtargetを満たせば、寸法縮小せずdoneを返す", () => {
    const encode = makeFakeEncode({ 256: 5000, 192: 4000, 128: 3000, 2: 100 });
    const getRgbaAtSize = vi.fn();
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(40000),
      100,
      100,
      3500,
    );
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.outputWidth).toBe(100);
      expect(outcome.outputHeight).toBe(100);
    }
    expect(getRgbaAtSize).not.toHaveBeenCalled();
  });

  it("256色(最高色数)で即座に達成した場合、encodeCount=1で終了する", () => {
    const encode = vi.fn(makeFakeEncode({ 256: 100 }));
    const getRgbaAtSize = vi.fn();
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(40000),
      100,
      100,
      1000,
    );
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.colorCount).toBe(256);
      expect(outcome.encodeCount).toBe(1);
    }
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("128色で初めて達成した場合、それ以降(96,64,...)の候補を呼ばない", () => {
    const encode = vi.fn(
      makeFakeEncode({ 256: 5000, 192: 4500, 128: 900, 96: 100, 64: 50, 2: 10 }),
    );
    const getRgbaAtSize = vi.fn();
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(40000),
      100,
      100,
      1000,
    );
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.colorCount).toBe(128);
    }
    expect(encode).toHaveBeenCalledTimes(3); // 256, 192, 128の3回のみ
  });

  it("大画像(largeティア: 128,32,8,2)で最初の候補(128)が達成した場合、1回で終了する", () => {
    const encode = vi.fn(makeFakeEncode({ 128: 500 }));
    const getRgbaAtSize = vi.fn();
    // 2,000,000pxを超える寸法にしてlargeティア(4候補)を使わせる
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(2000 * 1200 * 4),
      2000,
      1200,
      1000,
    );
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.colorCount).toBe(128);
    }
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("非単調(色数を増やすとサイズが減るケース)でも、target以下のうち最良の候補を選ぶ", () => {
    // 実際のUPNGで観測された非単調性を模した振る舞い: colorCount=64が256より小さい
    const encode = makeFakeEncode({
      256: 5000,
      192: 4500,
      128: 6000,
      96: 4800,
      64: 3000,
      48: 3200,
      32: 2000,
      24: 1800,
      16: 1200,
      12: 900,
      8: 700,
      6: 500,
      4: 300,
      2: 100,
    });
    const getRgbaAtSize = vi.fn();
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(40000),
      50,
      50,
      3500,
    );
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      // target以下の中で最大は colorCount=64 (3000bytes)。128は6000で超過、256/192も超過。
      expect(outcome.colorCount).toBe(64);
    }
  });

  it("フルサイズで全滅した場合、寸法縮小を試みる", () => {
    const getRgbaAtSize = vi.fn((w: number, h: number) => new ArrayBuffer(w * h * 4));
    const encode: UpngEncodeFunction = (_imgs, w, h, cnum) => {
      // フルサイズ(100x100)では常にtarget超過、縮小後は小さくなりtarget以下になる
      const scaleFactor = (w * h) / (100 * 100);
      // 色数が多いほど大きく、寸法が小さいほど小さくなる素直なモデル。
      // フルサイズ(scaleFactor=1)ではcolorCount=2でも733.6byte(>600のtarget)となり、
      // 縮小しない限りtargetを満たせない状況を作る
      const bytes = Math.max(50, Math.round(scaleFactor * (700 + 4300 * (cnum / 256))));
      return buildValidPng(w, h, new Array(Math.max(1, bytes - 60)).fill(1));
    };
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(40000),
      100,
      100,
      600,
    );
    expect(getRgbaAtSize).toHaveBeenCalled();
    expect(["done", "unreachable"]).toContain(outcome.status);
    if (outcome.status === "done") {
      expect(outcome.outputWidth).toBeLessThan(100);
    }
  });

  it("全候補が未達の場合、unreachableとbestCandidateを返す", () => {
    const encode = makeFakeEncode({ 256: 100000, 2: 90000 }); // どんな色数でも巨大
    const getRgbaAtSize = vi.fn((w: number, h: number) => new ArrayBuffer(w * h * 4));
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(40000),
      100,
      100,
      10,
      { ...DEFAULT_PNG_COMPRESSION_LIMITS, maxResizeStages: 1 },
    );
    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.bestCandidate).toBeDefined();
    }
  });

  it("未達のまま探索中にdeadlineを超えた場合、timeoutを返す", () => {
    let callCount = 0;
    const now = vi.fn(() => {
      callCount++;
      // 最初の2回(deadline算出+1候補目encode前のチェック)は基準時刻、
      // 1候補目のencode後(3回目)以降はdeadlineを超過させる
      return callCount <= 2 ? 0 : 999999;
    });
    const encode = makeFakeEncode({ 256: 100000 }); // どの色数でもtargetを満たさない
    const getRgbaAtSize = vi.fn((w: number, h: number) => new ArrayBuffer(w * h * 4));
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize, now },
      new ArrayBuffer(40000),
      100,
      100,
      1000,
    );
    expect(outcome.status).toBe("timeout");
  });

  it("達成候補を得た直後にdeadlineを超えていても、doneとして返し追加エンコードを行わない", () => {
    let callCount = 0;
    const now = vi.fn(() => {
      callCount++;
      // 1候補目のencode後(3回目)以降を呼び出せばdeadline超過を返すが、
      // 達成後は追加でnow()を呼ばないはずなのでこの分岐には到達しない
      return callCount <= 2 ? 0 : 999999;
    });
    const encode = vi.fn(makeFakeEncode({ 256: 100 })); // 1候補目(256色)で即座にtarget達成
    const getRgbaAtSize = vi.fn((w: number, h: number) => new ArrayBuffer(w * h * 4));
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize, now },
      new ArrayBuffer(40000),
      100,
      100,
      1000,
    );
    expect(outcome.status).toBe("done");
    expect(encode).toHaveBeenCalledTimes(1); // 2候補目(192等)は試みない
    expect(now).toHaveBeenCalledTimes(2); // 達成後に追加のdeadlineチェックを行わない
  });

  it("maxTotalEncodesに達すると無限ループせず終了する", () => {
    const encode = makeFakeEncode({});
    const getRgbaAtSize = vi.fn((w: number, h: number) => new ArrayBuffer(w * h * 4));
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(40000),
      100,
      100,
      1,
      { ...DEFAULT_PNG_COMPRESSION_LIMITS, maxTotalEncodes: 3 },
    );
    expect(["unreachable", "timeout"]).toContain(outcome.status);
  });

  it("エンコードが毎回失敗する(有効な候補が1件も得られない)場合はunsupported-png-encoderを返す", () => {
    const encode: UpngEncodeFunction = () => {
      throw new Error("encoder is broken");
    };
    const getRgbaAtSize = vi.fn((w: number, h: number) => new ArrayBuffer(w * h * 4));
    const outcome = runPngCompressionSearch(
      { encode, getRgbaAtSize },
      new ArrayBuffer(40000),
      100,
      100,
      1000,
    );
    expect(outcome.status).toBe("unsupported-png-encoder");
  });
});
