import { describe, expect, it } from "vitest";
import { detectWebpAnimation } from "./webp-animation-detection";

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function ascii(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}

function riffHeader(payloadLength: number): number[] {
  return [...ascii("RIFF"), ...u32le(4 + payloadLength), ...ascii("WEBP")];
}

/** RIFFチャンク1つ分(fourCC+size+payload)を組み立てる。奇数長payloadには必須のpaddingバイト(0)を付与する */
function webpChunk(fourCC: string, payload: number[]): number[] {
  const padding = payload.length % 2 === 1 ? [0] : [];
  return [...ascii(fourCC), ...u32le(payload.length), ...payload, ...padding];
}

function vp8xChunk(width: number, height: number, animationFlag: boolean): number[] {
  const flags = animationFlag ? 0x02 : 0x00;
  const payload = [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  return webpChunk("VP8X", payload);
}

function vp8SimpleChunk(width: number, height: number): number[] {
  const payload = [
    0x10,
    0x00,
    0x00,
    0x9d,
    0x01,
    0x2a,
    width & 0xff,
    (width >>> 8) & 0x3f,
    height & 0xff,
    (height >>> 8) & 0x3f,
  ];
  return webpChunk("VP8 ", payload);
}

function animChunk(): number[] {
  const payload = [0, 0, 0, 0, 0, 0]; // background color(4) + loop count(2)(判定には不使用)
  return webpChunk("ANIM", payload);
}

function anmfChunk(): number[] {
  const payload = new Array(16).fill(0); // ANMFフレームヘッダー最小長相当(判定には不使用)
  return webpChunk("ANMF", payload);
}

function buildStaticWebp(width: number, height: number): Uint8Array {
  const chunk = vp8xChunk(width, height, false);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

function buildSimpleWebp(width: number, height: number): Uint8Array {
  const chunk = vp8SimpleChunk(width, height);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

function buildAnimatedViaVp8xFlag(width: number, height: number): Uint8Array {
  const chunk = vp8xChunk(width, height, true);
  return new Uint8Array([...riffHeader(chunk.length), ...chunk]);
}

function buildAnimatedViaAnimChunk(width: number, height: number): Uint8Array {
  const vp8x = vp8xChunk(width, height, false);
  const anim = animChunk();
  return new Uint8Array([...riffHeader(vp8x.length + anim.length), ...vp8x, ...anim]);
}

function buildAnimatedViaAnmfChunk(width: number, height: number): Uint8Array {
  const vp8x = vp8xChunk(width, height, false);
  const anim = animChunk();
  const anmf = anmfChunk();
  return new Uint8Array([
    ...riffHeader(vp8x.length + anim.length + anmf.length),
    ...vp8x,
    ...anim,
    ...anmf,
  ]);
}

describe("detectWebpAnimation", () => {
  it("VP8X animation flagが立っている場合はanimatedと判定する", () => {
    expect(detectWebpAnimation(buildAnimatedViaVp8xFlag(400, 300))).toBe("animated");
  });

  it("ANIMチャンクが存在する場合はanimatedと判定する", () => {
    expect(detectWebpAnimation(buildAnimatedViaAnimChunk(400, 300))).toBe("animated");
  });

  it("ANMFチャンクが存在する場合はanimatedと判定する", () => {
    expect(detectWebpAnimation(buildAnimatedViaAnmfChunk(400, 300))).toBe("animated");
  });

  it("静止画のVP8X(animation flag無し)はstaticと判定する", () => {
    expect(detectWebpAnimation(buildStaticWebp(400, 300))).toBe("static");
  });

  it("静止画の単純形式(VP8)はstaticと誤検出されない", () => {
    expect(detectWebpAnimation(buildSimpleWebp(320, 240))).toBe("static");
  });

  it("RIFF/WEBPシグネチャが無いバイト列はnot-webpを返す", () => {
    expect(detectWebpAnimation(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe(
      "not-webp",
    );
  });

  it("空バイト列はnot-webpを返す", () => {
    expect(detectWebpAnimation(new Uint8Array([]))).toBe("not-webp");
  });

  it("チャンク長がファイル範囲外の場合はmalformedを返す(壊れたチャンク長)", () => {
    const bytes = buildStaticWebp(400, 300);
    const corrupted = new Uint8Array(bytes);
    // VP8Xチャンクのsizeフィールド(offset16-19)を実際のバッファ長を超える値へ壊す
    corrupted[16] = 0xff;
    corrupted[17] = 0xff;
    corrupted[18] = 0xff;
    corrupted[19] = 0x7f;
    expect(detectWebpAnimation(corrupted)).toBe("malformed");
  });

  it("チャンクサイズが整数オーバーフロー相当の巨大値でも例外を投げずmalformedを返す", () => {
    const bytes = buildStaticWebp(400, 300);
    const corrupted = new Uint8Array(bytes);
    corrupted[16] = 0xff;
    corrupted[17] = 0xff;
    corrupted[18] = 0xff;
    corrupted[19] = 0xff; // 0xFFFFFFFF
    expect(() => detectWebpAnimation(corrupted)).not.toThrow();
    expect(detectWebpAnimation(corrupted)).toBe("malformed");
  });

  it("奇数長チャンクのパディングを正しく読み飛ばして後続のANIMチャンクを検出する", () => {
    const vp8x = vp8xChunk(400, 300, false);
    // 奇数長ダミーチャンク("odd ")の後にANIMを続け、パディングが正しく処理されることを確認する
    const oddPayload = [1, 2, 3]; // 長さ3(奇数)
    const oddChunk = [...ascii("odd "), ...u32le(oddPayload.length), ...oddPayload, 0]; // パディング1byte
    const anim = animChunk();
    const bytes = new Uint8Array([
      ...riffHeader(vp8x.length + oddChunk.length + anim.length),
      ...vp8x,
      ...oddChunk,
      ...anim,
    ]);
    expect(detectWebpAnimation(bytes)).toBe("animated");
  });

  it("進行不能な不正チャンク(サイズ0が連続してもループしない)を安全に処理する", () => {
    // サイズ0のチャンクは8byteずつ進むため無限ループにはならないが、念のため大量に並べても
    // MAX_CHUNKS_TO_SCANで安全に打ち切られることを確認する
    const zeroChunks: number[] = [];
    for (let i = 0; i < 2000; i++) {
      zeroChunks.push(...ascii("XXXX"), ...u32le(0));
    }
    const bytes = new Uint8Array([...riffHeader(zeroChunks.length), ...zeroChunks]);
    expect(() => detectWebpAnimation(bytes)).not.toThrow();
    expect(detectWebpAnimation(bytes)).toBe("malformed");
  });
});
