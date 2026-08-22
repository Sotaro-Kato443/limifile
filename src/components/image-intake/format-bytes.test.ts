import { describe, expect, it } from "vitest";
import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  it("1000バイト未満はB表記になる", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("1000バイト以上はKB表記になる(10進基準)", () => {
    expect(formatBytes(1500)).toBe("1.5 KB");
  });

  it("1000KB以上はMB表記になる(10進基準)", () => {
    expect(formatBytes(1000 * 1000 * 2.5)).toBe("2.5 MB");
  });

  it("500,000バイトは500KBと表記される(圧縮機能の目標容量表示との整合性)", () => {
    expect(formatBytes(500_000)).toBe("500 KB");
  });
});
