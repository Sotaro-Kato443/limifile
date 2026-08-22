import { describe, expect, it } from "vitest";
import { SITE_PAGES } from "../scripts/lib/site-pages.mjs";
import {
  PUBLIC_PAGE_KEYS,
  getLocalesForPage,
  getPagePathnameWithoutLocale,
} from "../src/config/public-pages";
import { getToolDefinition } from "../src/config/tool-page-config";
import type { PublicPageKey } from "../src/config/public-pages";
import type { ToolPageKey } from "../src/config/tool-page-config";

const TOOL_PAGE_KEYS = new Set<PublicPageKey>([
  "default",
  "heic-to-jpg",
  "compress-image",
  "compress-image-to-500kb",
  "compress-image-to-20kb",
  "compress-image-to-50kb",
  "compress-image-to-100kb",
  "compress-image-to-200kb",
  "remove-exif",
  "png-to-webp",
  "compress-png",
  "png-to-jpg",
  "webp-to-jpg",
  "avif-to-jpg",
  "signature-resizer",
]);

/**
 * scripts/lib/site-pages.mjs(plain ESM、build scriptsが実行時に読み込む転記版)が、
 * src/config/public-pages.ts・src/config/tool-page-config.ts(TypeScript、実際の挙動の唯一の正)と
 * 完全に一致していることを保証するテスト。乖離した場合はこのテストが失敗するため、
 * 「ページを追加したのにmanifestの更新を忘れる」ことをCIで検出できる。
 */
describe("SITE_PAGES(scripts/lib/site-pages.mjs)とTypeScript側の実装が一致する", () => {
  it("keyの集合がPUBLIC_PAGE_KEYSと完全一致する(過不足なし)", () => {
    const manifestKeys = SITE_PAGES.map((page) => page.key).sort();
    const sourceKeys = [...PUBLIC_PAGE_KEYS].sort();
    expect(manifestKeys).toEqual(sourceKeys);
  });

  it("keyの並び順がPUBLIC_PAGE_KEYSと一致する(sitemap等の並び順の一貫性のため)", () => {
    expect(SITE_PAGES.map((page) => page.key)).toEqual(PUBLIC_PAGE_KEYS);
  });

  it.each(SITE_PAGES)("$key: slugがgetPagePathnameWithoutLocaleと一致する", (page) => {
    const expectedPathname = page.slug === "" ? "/" : `/${page.slug}`;
    expect(getPagePathnameWithoutLocale(page.key as PublicPageKey)).toBe(expectedPathname);
  });

  it.each(SITE_PAGES)("$key: localesがgetLocalesForPageと一致する", (page) => {
    expect([...page.locales].sort()).toEqual(
      [...getLocalesForPage(page.key as PublicPageKey)].sort(),
    );
  });

  it.each(SITE_PAGES)("$key: isToolがtool-page-config.ts側のkey集合と一致する", (page) => {
    expect(page.isTool).toBe(TOOL_PAGE_KEYS.has(page.key as PublicPageKey));
  });

  it.each(SITE_PAGES.filter((page) => page.isTool))(
    "$key: indexableがgetToolDefinition(key).indexableと一致する",
    (page) => {
      expect(page.indexable).toBe(getToolDefinition(page.key as ToolPageKey).indexable);
    },
  );

  it("非ツールページ(licenses/privacy/terms/contact)はすべてindexable=falseである(現行仕様)", () => {
    for (const page of SITE_PAGES.filter((p) => !p.isTool)) {
      expect(page.indexable).toBe(false);
    }
  });

  it("固定容量20/50/100/200KBページはlocalesが['en']のみで、indexable=trueである", () => {
    for (const slug of [
      "compress-image-to-20kb",
      "compress-image-to-50kb",
      "compress-image-to-100kb",
      "compress-image-to-200kb",
    ]) {
      const page = SITE_PAGES.find((p) => p.slug === slug);
      expect(page).toBeDefined();
      expect(page?.locales).toEqual(["en"]);
      expect(page?.indexable).toBe(true);
      expect(page?.isTool).toBe(true);
    }
  });

  it("既存の500KBページはlocalesが['en','ja']のままである(回帰確認)", () => {
    const page = SITE_PAGES.find((p) => p.slug === "compress-image-to-500kb");
    expect(page?.locales).toEqual(["en", "ja"]);
  });
});
