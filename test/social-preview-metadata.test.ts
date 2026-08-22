import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const baseLayoutSource = readFileSync(
  path.join(process.cwd(), "src/layouts/BaseLayout.astro"),
  "utf-8",
);
const ogImagePath = path.join(process.cwd(), "public/brand/limifile-og.png");

describe("共通OGP・SNSプレビュー", () => {
  it("1200x630のPNG画像を公開アセットとして持つ", () => {
    expect(existsSync(ogImagePath)).toBe(true);

    const image = readFileSync(ogImagePath);
    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
  });

  it("Open Graphへ画像URL・寸法・形式・locale別altを設定する", () => {
    expect(baseLayoutSource).toContain('property="og:image"');
    expect(baseLayoutSource).toContain('property="og:image:secure_url"');
    expect(baseLayoutSource).toContain('property="og:image:type" content="image/png"');
    expect(baseLayoutSource).toContain('property="og:image:width" content="1200"');
    expect(baseLayoutSource).toContain('property="og:image:height" content="630"');
    expect(baseLayoutSource).toContain('property="og:image:alt" content={ogImageAlt}');
    expect(baseLayoutSource).toContain("画像の変換・圧縮を、もっと手軽に");
    expect(baseLayoutSource).toContain("ファイルをサーバーへ送らず、端末内で処理");
  });

  it("X向けにlarge image cardと同じ画像・altを設定する", () => {
    expect(baseLayoutSource).toContain('name="twitter:card" content="summary_large_image"');
    expect(baseLayoutSource).toContain('name="twitter:title" content={title}');
    expect(baseLayoutSource).toContain('name="twitter:description" content={description}');
    expect(baseLayoutSource).toContain('name="twitter:image" content={ogImageUrl}');
    expect(baseLayoutSource).toContain('name="twitter:image:alt" content={ogImageAlt}');
  });
});
