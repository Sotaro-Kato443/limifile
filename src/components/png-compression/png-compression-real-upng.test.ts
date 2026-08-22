// @vitest-environment node
//
// このファイルだけは@upng/upng-jsをモックせず、実際のパッケージ(本番と同じ
// @upng/upng-js/dist/UPNG.esm.jsサブパス)を使う。目的は2つ:
// 1. Worker内window互換処理(loadUpngEncode)が、実際に10,000,000byte超の入力で
//    ReferenceErrorを起こさないことを実測すること(spike/png-target-compressionで
//    発見した既知のリスクの回帰テスト)。
// 2. 実際のUPNG量子化による透過(alpha)の挙動を実測すること。
//
// 検証(decode/toRGBA8)はこのテストファイル内でのみ、UPNG自身の自己整合性チェックとして
// 使用する。これは本番コード(png-compression-engine.ts / png-compression.worker.ts)が
// decode/toRGBA8を使わないという制約(§5)とは別の話であり、テストにおける結果検証手段として
// UPNG自身のdecoderを使うことは許容される。
import { afterEach, describe, expect, it } from "vitest";
import { loadUpngEncode } from "./png-compression-upng-loader";
import UPNG from "@upng/upng-js/dist/UPNG.esm.js";

function alloc(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

function decodeForVerification(pngBuffer: ArrayBuffer): {
  rgba: Uint8Array;
  width: number;
  height: number;
} {
  const img = UPNG.decode(pngBuffer);
  const frames = UPNG.toRGBA8(img);
  return { rgba: new Uint8Array(frames[0]), width: img.width, height: img.height };
}

describe("loadUpngEncode(実パッケージ) — window未定義環境での大画像エンコード", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("windowが存在しない環境(Node)でも、colorCount=256かつ10,000,000byte超のRGBAをReferenceErrorなくエンコードできる", async () => {
    expect((globalThis as unknown as { window?: unknown }).window).toBeUndefined();

    const width = 4000;
    const height = 3000; // RGBA = 48,000,000byte > 10,000,000byte
    const rgba = alloc(width, height).buffer as ArrayBuffer;

    const encode = await loadUpngEncode();

    // Worker内window互換処理により、globalThis.windowが割り当てられているはず
    expect((globalThis as unknown as { window?: unknown }).window).toBe(globalThis);

    expect(() => encode([rgba], width, height, 256)).not.toThrow();
    const output = encode([rgba], width, height, 256);
    expect(output.byteLength).toBeGreaterThan(0);
  }, 30000);
});

describe("実UPNGエンコードによる透過(alpha)の実測", () => {
  it("完全透明(alpha=0)の画素は、colorCount=2でも可視化しない(alpha!=0にならない)", async () => {
    const width = 20;
    const height = 20;
    const buf = alloc(width, height);
    for (let i = 0; i < width * height; i++) {
      const isLeft = i % width < width / 2;
      if (isLeft) {
        buf[i * 4] = 255;
        buf[i * 4 + 1] = 0;
        buf[i * 4 + 2] = 255;
        buf[i * 4 + 3] = 0; // 完全透明だが目立つRGBを混在させる
      } else {
        buf[i * 4] = 10;
        buf[i * 4 + 1] = 200;
        buf[i * 4 + 2] = 80;
        buf[i * 4 + 3] = 255;
      }
    }
    const encode = await loadUpngEncode();
    const output = encode([buf.buffer as ArrayBuffer], width, height, 2);
    const decoded = decodeForVerification(output);

    for (let i = 0; i < width * height; i++) {
      if (buf[i * 4 + 3] === 0) {
        expect(decoded.rgba[i * 4 + 3]).toBe(0);
      }
    }
  });

  it("完全不透明(alpha=255)の画素は大幅には変化しない", async () => {
    const width = 10;
    const height = 10;
    const buf = alloc(width, height);
    for (let i = 0; i < width * height; i++) {
      buf[i * 4] = 100;
      buf[i * 4 + 1] = 150;
      buf[i * 4 + 2] = 200;
      buf[i * 4 + 3] = 255;
    }
    const encode = await loadUpngEncode();
    const output = encode([buf.buffer as ArrayBuffer], width, height, 16);
    const decoded = decodeForVerification(output);

    for (let i = 0; i < width * height; i++) {
      expect(decoded.rgba[i * 4 + 3]).toBe(255);
    }
  });

  it("alpha 64/128/192の各画素の誤差を測定できる(実測、断定しない)", async () => {
    const width = 12;
    const height = 4;
    const buf = alloc(width, height);
    const steps = [64, 128, 192];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const band = steps[Math.floor((x / width) * steps.length)];
        buf[i * 4] = 50;
        buf[i * 4 + 1] = 100;
        buf[i * 4 + 2] = 150;
        buf[i * 4 + 3] = band;
      }
    }
    const encode = await loadUpngEncode();
    const output = encode([buf.buffer as ArrayBuffer], width, height, 64);
    const decoded = decodeForVerification(output);

    let maxAlphaError = 0;
    for (let i = 0; i < width * height; i++) {
      maxAlphaError = Math.max(maxAlphaError, Math.abs(buf[i * 4 + 3] - decoded.rgba[i * 4 + 3]));
    }
    expect(maxAlphaError).toBeLessThan(255); // 異常値でないことのみ保証(完全維持は断定しない)
  });

  it("半透明グラデーションはalpha誤差を測定可能で、異常なhaloは出ない", async () => {
    const width = 64;
    const height = 4;
    const buf = alloc(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        buf[i * 4] = 220;
        buf[i * 4 + 1] = 60;
        buf[i * 4 + 2] = 60;
        buf[i * 4 + 3] = Math.round((x / (width - 1)) * 255);
      }
    }
    const encode = await loadUpngEncode();
    const output = encode([buf.buffer as ArrayBuffer], width, height, 16);
    const decoded = decodeForVerification(output);

    let maxJump = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 1; x < width; x++) {
        const i = y * width + x;
        const prev = y * width + (x - 1);
        const jump = Math.abs(decoded.rgba[i * 4 + 3] - decoded.rgba[prev * 4 + 3]);
        maxJump = Math.max(maxJump, jump);
      }
    }
    // 隣接画素間のalpha変化が異常に大きい(halo)場合を検出する。
    // 元のグラデーションの最大隣接差は255/(width-1)程度のはずであり、量子化で多少広がっても
    // 大きく飛躍することは無いはず、というゆるい上限を設定する(断定的な完全一致は要求しない)。
    expect(maxJump).toBeLessThan(150);
  });
});
