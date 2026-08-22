import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeToolErrorCode, resolveCurrentToolId, trackToolEvent } from "./tool-events";

afterEach(() => {
  delete window.umami;
  window.history.replaceState({}, "", "/");
});

describe("resolveCurrentToolId", () => {
  it("英語・日本語の公開pathnameを同じtool idへ解決する", () => {
    expect(resolveCurrentToolId("/compress-image/")).toBe("compress-image");
    expect(resolveCurrentToolId("/ja/compress-image/")).toBe("compress-image");
    expect(resolveCurrentToolId("/signature-resizer/")).toBe("signature-resizer");
  });

  it("信頼ページ・未知ページは計測対象にしない", () => {
    expect(resolveCurrentToolId("/privacy/")).toBeNull();
    expect(resolveCurrentToolId("/ja/contact/")).toBeNull();
    expect(resolveCurrentToolId("/unknown/")).toBeNull();
  });
});

describe("normalizeToolErrorCode", () => {
  it("既知の内部理由を固定カテゴリへ正規化する", () => {
    expect(normalizeToolErrorCode("decode-failed")).toBe("decode_failed");
    expect(normalizeToolErrorCode("unsupported-webp-encoder")).toBe("unsupported_browser");
    expect(normalizeToolErrorCode("animated-png")).toBe("animated_image");
  });

  it("未知値や自由記述は送らず汎用カテゴリへ落とす", () => {
    expect(normalizeToolErrorCode("photo.jpg failed: private detail")).toBe("processing_failed");
    expect(normalizeToolErrorCode({ message: "private detail" })).toBe("processing_failed");
  });
});

describe("trackToolEvent", () => {
  it("イベント名・tool_id・正規化済みerror_code以外を送らない", () => {
    const track = vi.fn();
    window.umami = { track };
    window.history.replaceState({}, "", "/ja/png-to-webp/");

    trackToolEvent({ name: "process_start" });
    trackToolEvent({ name: "process_error", errorCode: "encode_failed" });

    expect(track).toHaveBeenNthCalledWith(1, "process_start", { tool_id: "png-to-webp" });
    expect(track).toHaveBeenNthCalledWith(2, "process_error", {
      tool_id: "png-to-webp",
      error_code: "encode_failed",
    });
  });

  it("Umami未読込時と計測対象外ページでは何も送らない", () => {
    expect(() => trackToolEvent({ name: "download" })).not.toThrow();

    const track = vi.fn();
    window.umami = { track };
    window.history.replaceState({}, "", "/privacy/");
    trackToolEvent({ name: "download" });

    expect(track).not.toHaveBeenCalled();
  });
});
