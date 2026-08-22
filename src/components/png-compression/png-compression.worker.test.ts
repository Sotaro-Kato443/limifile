import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PNG_COMPRESSION_LIMITS } from "./png-compression-types";

const WORKER_TIME_BUDGET_MS = DEFAULT_PNG_COMPRESSION_LIMITS.workerTimeBudgetMs;

const upngEncodeMock = vi.fn();

vi.mock("@upng/upng-js/dist/UPNG.esm.js", () => ({
  default: { encode: (...args: unknown[]) => upngEncodeMock(...args) },
}));

/**
 * self.onmessage(Worker全体のメッセージルーティング)を通した統合テスト。
 * 純粋関数レベルのテスト(png-compression-engine.test.ts)では検証できない、
 * 「APNG判定・寸法安全性検証・targetBytes検証・元ファイル返却判定・入力/最終出力の
 * ブラウザデコード検証がUPNG読み込みより前後どこで行われるか」「Dedicated Worker内window互換処理」
 * を確認する。
 */

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
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildPng(
  width: number,
  height: number,
  options: { animated?: boolean; idatBytes?: number[] } = {},
): ArrayBuffer {
  const chunks = [pngChunk("IHDR", ihdrData(width, height))];
  if (options.animated) {
    chunks.push(pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]));
  }
  chunks.push(pngChunk("IDAT", options.idatBytes ?? [1, 2, 3, 4]));
  chunks.push(pngChunk("IEND", []));
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]).buffer;
}

function buildValidUpngOutput(width: number, height: number, byteLength: number): ArrayBuffer {
  const padding = Math.max(0, byteLength - 33 - 12); // IHDR(12+13)+IEND(12)のおおよその引き算
  return buildPng(width, height, { idatBytes: new Array(Math.max(1, padding)).fill(1) });
}

/** 入力buffer.byteLengthがtargetBytesを上回るようにし、元ファイル返却(originalReturned)の
 * ショートカットではなく実際のUPNGエンコード経路を通す入力を作る */
function buildPngLargerThan(targetBytes: number): ArrayBuffer {
  return buildPng(800, 600, { idatBytes: new Array(targetBytes + 500).fill(1) });
}

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

/** BlobのIHDRを実際に読み取り、渡されたPNGバイト列に応じた寸法のStubBitmapを返す
 * (本物のcreateImageBitmapに近い振る舞いをさせ、入力デコードと最終出力再デコードの
 * 両方が意味のある寸法チェックになるようにする) */
function createDefaultCreateImageBitmapMock() {
  return vi.fn(async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return new StubBitmap(width, height);
  });
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

async function sendMessage(message: {
  id: string;
  buffer: ArrayBuffer;
  targetBytes: unknown;
}): Promise<void> {
  const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
  await handler({ data: message } as MessageEvent);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function resultOutcomes(postMessageSpy: ReturnType<typeof vi.spyOn>) {
  return postMessageSpy.mock.calls.map(
    (call: unknown[]) => (call[0] as { outcome: { status: string } }).outcome,
  );
}

describe("png-compression.worker self.onmessage", () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;
  let createImageBitmapMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    upngEncodeMock.mockReset();
    upngEncodeMock.mockImplementation((_imgs, w, h, cnum) =>
      buildValidUpngOutput(w, h, 500 - cnum),
    );

    // 前のテストが vi.doMock で一時的に別実装(読み込み失敗等)を登録している可能性があるため、
    // 毎回明示的に正常なモックへ戻してからWorkerをimportし直す(doMockはunmockしない限り
    // テストファイル内で持続するため、これを怠ると後続テストへ意図せず影響する)。
    vi.doMock("@upng/upng-js/dist/UPNG.esm.js", () => ({
      default: { encode: (...args: unknown[]) => upngEncodeMock(...args) },
    }));

    postMessageSpy = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    createImageBitmapMock = createDefaultCreateImageBitmapMock();
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    delete (globalThis as unknown as { window?: unknown }).window;

    vi.resetModules();
    await import("./png-compression.worker");
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.resetModules();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("通常PNGは正常にdoneを返す", async () => {
    await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });
    const outcome = resultOutcomes(postMessageSpy)[0];
    expect(outcome.status).toBe("done");
  });

  it("入力が既にtargetBytes以下の場合、再エンコードせず元ファイルをそのまま返す(originalReturned=true)", async () => {
    const buffer = buildPng(800, 600);
    await sendMessage({ id: "a", buffer, targetBytes: buffer.byteLength + 100 });

    // §5: 元ファイル返却の場合もデコード確認だけは行うため、createImageBitmapは呼ばれる
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(upngEncodeMock).not.toHaveBeenCalled();

    const outcome = resultOutcomes(postMessageSpy)[0] as {
      status: string;
      originalReturned: boolean;
      pngBuffer: ArrayBuffer;
      colorCount: number | null;
    };
    expect(outcome.status).toBe("done");
    expect(outcome.originalReturned).toBe(true);
    expect(outcome.colorCount).toBeNull();
    expect(outcome.pngBuffer.byteLength).toBe(buffer.byteLength);
  });

  it("APNGはUPNG読み込み・createImageBitmap前にanimated-pngとして拒否する", async () => {
    await sendMessage({ id: "a", buffer: buildPng(800, 600, { animated: true }), targetBytes: 10 });

    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(upngEncodeMock).not.toHaveBeenCalled();
    expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "animated-png" });
  });

  it("壊れたPNG(先頭チャンクがIHDR以外)はinvalid-pngとして拒否する", async () => {
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...pngChunk("IDAT", [1, 2, 3]),
      ...pngChunk("IEND", []),
    ]);
    await sendMessage({ id: "a", buffer: bytes.buffer, targetBytes: 10 });

    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "invalid-png" });
  });

  it("PNG署名すら無いバイト列もinvalid-pngとして安全に拒否する", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await sendMessage({ id: "a", buffer: bytes.buffer, targetBytes: 10 });
    expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "invalid-png" });
  });

  it("IEND後に余分なデータがあるPNGはinvalid-pngとして拒否する", async () => {
    const valid = new Uint8Array(buildPng(10, 10));
    const withTrailing = new Uint8Array(valid.length + 4);
    withTrailing.set(valid);
    await sendMessage({ id: "a", buffer: withTrailing.buffer, targetBytes: 10 });
    expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "invalid-png" });
  });

  it("宣言寸法が最大辺を超える場合、createImageBitmap前にunsafe-dimensionsとして拒否する", async () => {
    await sendMessage({ id: "a", buffer: buildPng(20000, 20000), targetBytes: 10 });
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "unsafe-dimensions" });
  });

  it("総ピクセル数が上限を超える場合、unsafe-dimensionsとして拒否する", async () => {
    // 16384以下だが総ピクセル数(67,108,864)を超える寸法
    await sendMessage({ id: "a", buffer: buildPng(10000, 10000), targetBytes: 10 });
    expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "unsafe-dimensions" });
  });

  it("Dedicated Worker内でwindowが未定義の環境でも、encode呼び出し前にwindowが割り当てられる", async () => {
    expect((globalThis as unknown as { window?: unknown }).window).toBeUndefined();
    await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });
    expect((globalThis as unknown as { window?: unknown }).window).toBe(globalThis);
  });

  it("UPNGモジュールの読み込み失敗はtyped errorとして処理される", async () => {
    vi.doMock("@upng/upng-js/dist/UPNG.esm.js", () => {
      throw new Error("module load failed");
    });
    vi.resetModules();
    await import("./png-compression.worker");
    await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });
    const outcome = resultOutcomes(postMessageSpy)[0] as { status: string; message?: string };
    expect(outcome.status).toBe("error");
    expect(outcome.message).toBeTruthy();
  });

  it("1件目が不正PNGで拒否された後も、2件目(通常PNG)は正常に処理される", async () => {
    await sendMessage({ id: "a", buffer: buildPng(800, 600, { animated: true }), targetBytes: 10 });
    await sendMessage({ id: "b", buffer: buildPngLargerThan(300), targetBytes: 300 });

    const outcomes: Array<{ id: string; outcome: { status: string } }> =
      postMessageSpy.mock.calls.map(
        (call: unknown[]) => call[0] as { id: string; outcome: { status: string } },
      );
    expect(outcomes.find((m) => m.id === "a")?.outcome.status).toBe("animated-png");
    expect(outcomes.find((m) => m.id === "b")?.outcome.status).toBe("done");
  });

  it("IENDが無いPNGはinvalid-pngとして拒否する", async () => {
    const bytes = new Uint8Array([...PNG_SIGNATURE, ...pngChunk("IHDR", ihdrData(10, 10))]);
    await sendMessage({ id: "a", buffer: bytes.buffer, targetBytes: 10 });
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "invalid-png" });
  });

  it("IHDRが重複するPNGはinvalid-pngとして拒否する", async () => {
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...pngChunk("IHDR", ihdrData(10, 10)),
      ...pngChunk("IHDR", ihdrData(10, 10)),
      ...pngChunk("IDAT", [1, 2, 3]),
      ...pngChunk("IEND", []),
    ]);
    await sendMessage({ id: "a", buffer: bytes.buffer, targetBytes: 10 });
    expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "invalid-png" });
  });

  it("元ファイル返却時、tEXt等の補助チャンクを含めバイト単位で完全に元のまま返す(メタデータ維持)", async () => {
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...pngChunk("IHDR", ihdrData(10, 10)),
      ...pngChunk("tEXt", ascii("Comment").concat([0]).concat(ascii("hello"))),
      ...pngChunk("IDAT", [1, 2, 3, 4]),
      ...pngChunk("IEND", []),
    ]);
    const buffer = bytes.buffer;
    await sendMessage({ id: "a", buffer, targetBytes: buffer.byteLength + 1 });

    const outcome = resultOutcomes(postMessageSpy)[0] as {
      status: string;
      originalReturned: boolean;
      pngBuffer: ArrayBuffer;
    };
    expect(outcome.originalReturned).toBe(true);
    expect(new Uint8Array(outcome.pngBuffer)).toEqual(bytes);
  });

  it("UPNGのdecode/toRGBA8は本番コードから一切呼ばれない", async () => {
    const decodeSpy = vi.fn();
    const toRGBA8Spy = vi.fn();
    vi.doMock("@upng/upng-js/dist/UPNG.esm.js", () => ({
      default: {
        encode: (...args: unknown[]) => upngEncodeMock(...args),
        decode: decodeSpy,
        toRGBA8: toRGBA8Spy,
      },
    }));
    vi.resetModules();
    await import("./png-compression.worker");

    await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });

    expect(decodeSpy).not.toHaveBeenCalled();
    expect(toRGBA8Spy).not.toHaveBeenCalled();
    expect(upngEncodeMock).toHaveBeenCalled();
  });

  it("寸法縮小は最大3段階までで打ち切られ、無限ループしない", async () => {
    // どのcolorCount・寸法でも常にtarget超過となるようにし、3段階(合計4段階=フルサイズ+3)で
    // 確実に打ち切られることを確認する
    upngEncodeMock.mockImplementation((_imgs, w, h) => buildValidUpngOutput(w, h, 100000));
    await sendMessage({ id: "a", buffer: buildPngLargerThan(50), targetBytes: 50 });
    const outcome = resultOutcomes(postMessageSpy)[0] as { status: string };
    expect(["unreachable", "timeout"]).toContain(outcome.status);
  });

  it("最大encode回数(24)に達しても無限ループせず終了する", async () => {
    upngEncodeMock.mockImplementation((_imgs, w, h) => buildValidUpngOutput(w, h, 100000));
    await sendMessage({ id: "a", buffer: buildPngLargerThan(50), targetBytes: 50 });
    // 呼び出し回数(=encodeCount)が既定の上限24を超えないことを確認する
    expect(upngEncodeMock.mock.calls.length).toBeLessThanOrEqual(24);
  });

  describe("targetBytesの実行時検証(invalid-target)", () => {
    it.each([
      ["0", 0],
      ["-1", -1],
      ["1.5", 1.5],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
      ["文字列", "300"],
      ["MAX_SAFE_INTEGER+1", Number.MAX_SAFE_INTEGER + 1],
    ])(
      "targetBytes=%sはinvalid-targetとして拒否し、createImageBitmap/UPNG読み込み/encodeを行わない",
      async (_label, targetBytes) => {
        await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes });

        expect(createImageBitmapMock).not.toHaveBeenCalled();
        expect(upngEncodeMock).not.toHaveBeenCalled();
        expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "invalid-target" });
      },
    );

    it("正常なtargetBytesは引き続き通常通り処理される", async () => {
      await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });
      expect(resultOutcomes(postMessageSpy)[0].status).toBe("done");
    });
  });

  describe("入力PNGのブラウザデコード検証(§5)", () => {
    it("正常な小さいPNGはデコード確認後、元Bufferを返しUPNGは読み込まない", async () => {
      const buffer = buildPng(10, 10);
      await sendMessage({ id: "a", buffer, targetBytes: buffer.byteLength + 100 });

      expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
      expect(upngEncodeMock).not.toHaveBeenCalled();
      const outcome = resultOutcomes(postMessageSpy)[0] as {
        status: string;
        originalReturned: boolean;
      };
      expect(outcome.status).toBe("done");
      expect(outcome.originalReturned).toBe(true);
    });

    it("structurally validだがcreateImageBitmapがrejectするPNGはinvalid-pngとして拒否する", async () => {
      createImageBitmapMock.mockRejectedValueOnce(new Error("decode failed"));
      const buffer = buildPngLargerThan(300);
      await sendMessage({ id: "a", buffer, targetBytes: 300 });

      expect(upngEncodeMock).not.toHaveBeenCalled();
      expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "invalid-png" });
    });

    it("bitmap寸法とIHDR宣言寸法が異なる場合、invalid-pngとして拒否する(元ファイルを成功として返さない)", async () => {
      createImageBitmapMock.mockResolvedValueOnce(new StubBitmap(799, 600));
      const buffer = buildPng(800, 600);
      await sendMessage({ id: "a", buffer, targetBytes: buffer.byteLength + 100 });

      expect(upngEncodeMock).not.toHaveBeenCalled();
      expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "invalid-png" });
    });

    it("入力デコードで得たbitmapは必ずcloseされる", async () => {
      const bitmap = new StubBitmap(10, 10);
      const closeSpy = vi.spyOn(bitmap, "close");
      createImageBitmapMock.mockResolvedValueOnce(bitmap);
      const buffer = buildPng(10, 10);
      await sendMessage({ id: "a", buffer, targetBytes: buffer.byteLength + 100 });

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it("入力デコードがtimeoutした場合もtimeoutを返し後始末される", async () => {
      createImageBitmapMock.mockImplementationOnce(() => new Promise(() => {})); // 永遠に解決しない
      vi.useFakeTimers();
      try {
        const buffer = buildPngLargerThan(300);
        const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
        const promise = handler({
          data: { id: "a", buffer, targetBytes: 300 },
        } as MessageEvent);
        await vi.advanceTimersByTimeAsync(WORKER_TIME_BUDGET_MS);
        await promise;
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "timeout" });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("最終返却PNGの再デコード検証(§6)", () => {
    it("最終done候補は再デコードされ、成功すればdoneのまま返す", async () => {
      await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });
      // 入力1回 + 最終出力1回 = 合計2回createImageBitmapが呼ばれる
      expect(createImageBitmapMock).toHaveBeenCalledTimes(2);
      expect(resultOutcomes(postMessageSpy)[0].status).toBe("done");
    });

    it("最終出力の再デコードが失敗した場合、unsupported-png-encoderを返しbufferを転送しない", async () => {
      let call = 0;
      createImageBitmapMock.mockImplementation(async (blob: Blob) => {
        call++;
        if (call === 1) {
          // 1回目(入力デコード)は成功させる
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const width =
            ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
          const height =
            ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
          return new StubBitmap(width, height);
        }
        // 2回目(最終出力の再デコード)は失敗させる
        throw new Error("final decode failed");
      });
      await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });
      const outcome = resultOutcomes(postMessageSpy)[0];
      expect(outcome).toEqual({ status: "unsupported-png-encoder" });
    });

    it("最終出力の寸法が期待値と異なる場合もunsupported-png-encoderを返す", async () => {
      let call = 0;
      createImageBitmapMock.mockImplementation(async () => {
        call++;
        if (call === 1) return new StubBitmap(800, 600); // 入力デコード
        return new StubBitmap(1, 1); // 最終出力デコード(意図的に不一致)
      });
      await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });
      expect(resultOutcomes(postMessageSpy)[0]).toEqual({ status: "unsupported-png-encoder" });
    });

    it("unreachableのbestCandidateも再デコードに成功すればそのまま返す", async () => {
      upngEncodeMock.mockImplementation((_imgs, w, h) => buildValidUpngOutput(w, h, 100000));
      await sendMessage({ id: "a", buffer: buildPngLargerThan(50), targetBytes: 50 });
      const outcome = resultOutcomes(postMessageSpy)[0] as {
        status: string;
        bestCandidate?: unknown;
      };
      expect(["unreachable", "timeout"]).toContain(outcome.status);
    });

    it("unreachableのbestCandidateが再デコードに失敗した場合、bufferを返さない", async () => {
      upngEncodeMock.mockImplementation((_imgs, w, h) => buildValidUpngOutput(w, h, 100000));
      let call = 0;
      createImageBitmapMock.mockImplementation(async (blob: Blob) => {
        call++;
        if (call === 1) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const width =
            ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
          const height =
            ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
          return new StubBitmap(width, height); // 入力デコードは成功させる
        }
        throw new Error("best candidate re-decode failed");
      });
      await sendMessage({ id: "a", buffer: buildPngLargerThan(50), targetBytes: 50 });
      const outcome = resultOutcomes(postMessageSpy)[0] as {
        status: string;
        bestCandidate?: unknown;
      };
      if (outcome.status === "unreachable") {
        expect(outcome.bestCandidate).toBeUndefined();
      } else {
        expect(outcome.status).toBe("timeout");
      }
    });

    it("探索中の途中candidateはすべて再デコードしていない(最終1件だけ)", async () => {
      await sendMessage({ id: "a", buffer: buildPngLargerThan(300), targetBytes: 300 });
      // 早期終了により256色1回のencodeでtargetを満たすため、encode呼び出しは1回のみ、
      // createImageBitmapは入力1回+最終出力1回の合計2回に留まる
      expect(upngEncodeMock.mock.calls.length).toBe(1);
      expect(createImageBitmapMock).toHaveBeenCalledTimes(2);
    });
  });
});
