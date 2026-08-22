import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const decodeMock = vi.fn();

vi.mock("@discourse/heic/decode", () => ({
  default: (...args: unknown[]) => decodeMock(...args),
}));

/**
 * self.onmessage(Worker全体のメッセージルーティング)を通した統合テスト。
 * 純粋関数レベルのテスト(heic-convert.worker.test.ts)では検証できない、
 * 「quality検証がdecode()前に行われること」を確認する。
 */

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
  async convertToBlob(opts: { type: string; quality?: number }) {
    return new Blob([new Uint8Array([1, 2, 3])], { type: opts.type });
  }
}

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  } as ImageData;
}

async function sendMessage(message: {
  id: string;
  buffer: ArrayBuffer;
  quality: number;
}): Promise<void> {
  const handler = self.onmessage as unknown as (event: MessageEvent) => Promise<void> | void;
  await handler({ data: message } as MessageEvent);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function resultMessages(
  postMessageSpy: ReturnType<typeof vi.spyOn>,
): Array<{ id: string; status: string; message?: string }> {
  return postMessageSpy.mock.calls.map(
    (call: unknown[]) => call[0] as { id: string; status: string; message?: string },
  );
}

describe("heic-convert.worker self.onmessage", () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    decodeMock.mockReset();
    decodeMock.mockResolvedValue(makeImageData(800, 600));
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    postMessageSpy = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    await import("./heic-convert.worker");
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("quality 0.8は許可され正常にdoneを返す", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(8), quality: 0.8 });
    const message = resultMessages(postMessageSpy)[0];
    expect(message.status).toBe("done");
    expect(decodeMock).toHaveBeenCalledTimes(1);
  });

  it("quality 1.0はdecode()を呼ぶ前にinvalid-qualityとして拒否する", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(8), quality: 1.0 });

    expect(decodeMock).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", status: "invalid-quality" });
  });

  it("quality 0.75はdecode()を呼ぶ前にinvalid-qualityとして拒否する", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(8), quality: 0.75 });

    expect(decodeMock).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", status: "invalid-quality" });
  });

  it("quality 0はdecode()を呼ぶ前にinvalid-qualityとして拒否する", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(8), quality: 0 });

    expect(decodeMock).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", status: "invalid-quality" });
  });

  it("負のqualityはdecode()を呼ぶ前にinvalid-qualityとして拒否する", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(8), quality: -0.8 });

    expect(decodeMock).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", status: "invalid-quality" });
  });

  it("quality NaNはdecode()を呼ぶ前にinvalid-qualityとして拒否する", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(8), quality: NaN });

    expect(decodeMock).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", status: "invalid-quality" });
  });

  it("quality Infinityはdecode()を呼ぶ前にinvalid-qualityとして拒否する", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(8), quality: Infinity });

    expect(decodeMock).not.toHaveBeenCalled();
    const message = resultMessages(postMessageSpy)[0];
    expect(message).toEqual({ id: "a", status: "invalid-quality" });
  });

  it("1件目が不正qualityで拒否された後も、2件目(quality 0.8)は正常に処理される", async () => {
    await sendMessage({ id: "a", buffer: new ArrayBuffer(8), quality: 1.0 });
    await sendMessage({ id: "b", buffer: new ArrayBuffer(8), quality: 0.8 });

    const messages = resultMessages(postMessageSpy);
    expect(messages.find((m) => m.id === "a")?.status).toBe("invalid-quality");
    expect(messages.find((m) => m.id === "b")?.status).toBe("done");
  });
});
