import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import decode, { init } from "@discourse/heic/decode";

/**
 * 実HEIC fixtureを実際の@discourse/heic decoderへ通す正常系テスト。
 * 他のheic-convert.worker*.test.tsはdecode()をmockしているため、
 * decoder自体の破損(upstream更新・WASM再ビルド等による)はこれらでは検知できない。
 * このファイルだけはdecode()をmockせず、test/fixtures/heic/README.md記載の
 * 自作合成画像(実写ではない)を実decoderへ通して検証する。
 */

const FIXTURE_PATH = path.join(process.cwd(), "test/fixtures/heic/synthetic-fixture.heic");
const WASM_PATH = path.join(process.cwd(), "node_modules/@discourse/heic/codec/dec/heic_dec.wasm");

const EXPECTED_WIDTH = 64;
const EXPECTED_HEIGHT = 64;

function readFixtureAsArrayBuffer(): ArrayBuffer {
  const buf = readFileSync(FIXTURE_PATH);
  // Vitest's jsdom environment runs this file's code in a different realm
  // than Node's `fs` module, so `buf.buffer` (Node-realm ArrayBuffer) fails
  // embind's `instanceof ArrayBuffer`/`instanceof Uint8Array` wire-type
  // checks in heic_dec.js even though the bytes are correct. Re-wrap the
  // bytes in a Uint8Array constructed from *this* realm (a plain value
  // copy, not an identity/reference) so `instanceof` checks evaluated
  // inside heic_dec.js succeed.
  const local = new Uint8Array(buf.length);
  local.set(buf);
  return local.buffer;
}

let decodedImage: ImageData;

beforeAll(async () => {
  // heic_dec.js(jSquashのMakefileが -s ENVIRONMENT=web,worker でビルド)は、
  // WASM instantiateに常にfetch()を使う実装になっている。jsdom/NodeのfetchはWorker/
  // ブラウザと異なりfile://をサポートしないため、そのままdecode()を呼ぶとfetch失敗で
  // 例外になる。@discourse/heic/decodeが公開しているinit(wasmModule)へ事前にコンパイル
  // 済みWebAssembly.Moduleを渡すことで、内部のfetchベース読み込みを完全に迂回できる
  // (jSquash自身のutils.tsが「手動instantiateを可能にする変更」として提供している経路。
  // LimiFileリポジトリ内の.github/workflows/verify-lgpl-heic-source-rebuild/
  // decode-smoke-test.mjsも同じ迂回パターンを使っている)。
  const wasmModule = await WebAssembly.compile(readFileSync(WASM_PATH));
  await init(wasmModule);
  decodedImage = await decode(readFixtureAsArrayBuffer());
}, 30_000);

function samplePixel(x: number, y: number): [number, number, number, number] {
  const i = (y * decodedImage.width + x) * 4;
  return [
    decodedImage.data[i],
    decodedImage.data[i + 1],
    decodedImage.data[i + 2],
    decodedImage.data[i + 3],
  ];
}

/** HEIC(HEVC)は非可逆圧縮のため、再エンコード後のピクセル値は数値レベルでは完全一致しない。 */
function expectColorNear(
  actual: readonly [number, number, number, number],
  expected: readonly [number, number, number, number],
  tolerance = 20,
): void {
  for (let channel = 0; channel < 4; channel++) {
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(tolerance);
  }
}

describe("実HEIC fixtureを実decoderへ通す(decode()はmockしない)", () => {
  it("decodeが成功し、結果が空でない", () => {
    expect(decodedImage).toBeTruthy();
    expect(decodedImage.data.length).toBeGreaterThan(0);
  });

  it("幅・高さがfixtureの既知寸法(64x64)と一致する", () => {
    expect(decodedImage.width).toBe(EXPECTED_WIDTH);
    expect(decodedImage.height).toBe(EXPECTED_HEIGHT);
  });

  it("RGBAデータ長がwidth*height*4と一致する", () => {
    expect(decodedImage.data.length).toBe(EXPECTED_WIDTH * EXPECTED_HEIGHT * 4);
  });

  it("4象限の代表ピクセルと中央の白丸が、既知の合成色から大きく壊れていない", () => {
    expectColorNear(samplePixel(16, 16), [220, 30, 30, 255]); // 左上: 赤
    expectColorNear(samplePixel(48, 16), [30, 160, 30, 255]); // 右上: 緑
    expectColorNear(samplePixel(16, 48), [30, 60, 220, 255]); // 左下: 青
    expectColorNear(samplePixel(48, 48), [230, 210, 20, 255]); // 右下: 黄
    expectColorNear(samplePixel(32, 32), [255, 255, 255, 255]); // 中央: 白丸
  });
});

/**
 * decode()は実decoderのまま、OffscreenCanvas(ブラウザAPI)だけをstubして
 * convertHeicBufferToJpeg全体を通す。jsdomにはCanvas 2D実装が無く、
 * OffscreenCanvas.convertToBlob()での実JPEGエンコードは安定して検証できないため、
 * ここではJPEGバイト自体の妥当性ではなく「実decodeの出力(寸法等)が
 * 正しくエンコード工程まで伝播すること」だけを検証する対象として明示的に分離する。
 */
describe("実decode結果がconvertHeicBufferToJpegへ伝播する(OffscreenCanvasのみstub)", () => {
  class StubOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { putImageData: vi.fn() };
    }
    async convertToBlob(opts: { type: string }) {
      // 実JPEGエンコードではなく、MIME/非空だけを模擬するstub。
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: opts.type });
    }
  }

  beforeAll(() => {
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("real decode + stub encodeで done を返し、寸法は実decode由来の値と一致する", async () => {
    const { convertHeicBufferToJpeg } = await import("./heic-convert.worker");
    const result = await convertHeicBufferToJpeg(readFixtureAsArrayBuffer(), 0.8);

    expect(result.status).toBe("done");
    if (result.status === "done") {
      expect(result.width).toBe(EXPECTED_WIDTH);
      expect(result.height).toBe(EXPECTED_HEIGHT);
      expect(result.jpegType).toBe("image/jpeg");
      expect(result.jpegBuffer.byteLength).toBeGreaterThan(0);
    }
  });
});
