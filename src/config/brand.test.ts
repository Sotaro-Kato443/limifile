import { describe, expect, it } from "vitest";

import { BRAND_NAME, BRAND_NAME_JA, BRAND_SLUG, LEGACY_BRAND_NAME } from "./brand";

describe("brand configuration", () => {
  it("defines the new public brand consistently", () => {
    expect(BRAND_NAME).toBe("LimiFile");
    expect(BRAND_NAME_JA).toBe("リミファイル");
    expect(BRAND_SLUG).toBe("limifile");
    expect(LEGACY_BRAND_NAME).toBe("FileFit");
  });
});
