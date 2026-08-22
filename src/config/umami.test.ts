import { describe, expect, it } from "vitest";
import { resolveUmamiPublicConfig } from "./umami";

const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";

describe("resolveUmamiPublicConfig", () => {
  it("website id未設定時はtrackerを完全に無効化する", () => {
    expect(resolveUmamiPublicConfig(undefined, undefined)).toBeNull();
    expect(resolveUmamiPublicConfig("   ", "https://example.com/script.js")).toBeNull();
  });

  it("website idだけならUmami Cloud公式trackerを使う", () => {
    expect(resolveUmamiPublicConfig(WEBSITE_ID, undefined)).toEqual({
      websiteId: WEBSITE_ID,
      scriptUrl: "https://cloud.umami.is/script.js",
    });
  });

  it("セルフホスト等のHTTPS tracker URLを明示できる", () => {
    expect(resolveUmamiPublicConfig(WEBSITE_ID, "https://stats.example.com/script.js")).toEqual({
      websiteId: WEBSITE_ID,
      scriptUrl: "https://stats.example.com/script.js",
    });
  });

  it("不正UUID・HTTP・不正URLはbuildを失敗させる", () => {
    expect(() => resolveUmamiPublicConfig("placeholder", undefined)).toThrow(/valid UUID/);
    expect(() =>
      resolveUmamiPublicConfig(WEBSITE_ID, "http://stats.example.com/script.js"),
    ).toThrow(/HTTPS/);
    expect(() => resolveUmamiPublicConfig(WEBSITE_ID, "not a URL")).toThrow(/valid HTTPS URL/);
  });
});
