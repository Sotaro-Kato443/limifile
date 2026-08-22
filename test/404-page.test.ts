import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getToolCards, resolveNavItems } from "../src/config/tool-page-config";
import { resolvePublicPageKeyStrict } from "../src/config/public-pages";

const source404En = readFileSync(path.join(process.cwd(), "src/pages/404.astro"), "utf-8");
const source404Ja = readFileSync(path.join(process.cwd(), "src/pages/ja/404.astro"), "utf-8");
const notFoundPageSource = readFileSync(
  path.join(process.cwd(), "src/components/pages/NotFoundPage.astro"),
  "utf-8",
);
const baseLayoutSource = readFileSync(
  path.join(process.cwd(), "src/layouts/BaseLayout.astro"),
  "utf-8",
);
const jaDictionarySource = readFileSync(
  path.join(process.cwd(), "src/i18n/dictionaries/ja.ts"),
  "utf-8",
);
const enDictionarySource = readFileSync(
  path.join(process.cwd(), "src/i18n/dictionaries/en.ts"),
  "utf-8",
);

describe("src/pages/404.astro(英語root)・src/pages/ja/404.astro(日本語)", () => {
  it("両方存在し、共有NotFoundPageコンポーネントをlocaleだけ変えて呼び出す薄い入口である", () => {
    expect(source404En.length).toBeGreaterThan(0);
    expect(source404Ja.length).toBeGreaterThan(0);
    expect(source404En).toMatch(/<NotFoundPage\s+locale="en"\s*\/>/);
    expect(source404Ja).toMatch(/<NotFoundPage\s+locale="ja"\s*\/>/);
  });

  it("重複実装(同じ画像処理・レイアウトロジックの複製)をしていない(NotFoundPage 1箇所のみ)", () => {
    expect(source404En).not.toContain("Workbench");
    expect(source404Ja).not.toContain("Workbench");
  });
});

describe("src/components/pages/NotFoundPage.astro(共有実装)", () => {
  it("noindex, nofollowを常に含む(グローバル設定に依存しない固定値)", () => {
    expect(notFoundPageSource).toMatch(/<BaseLayout[^>]*\bindexable=\{false\}/s);
    expect(baseLayoutSource).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("localeに応じたdictionary.notFound.headingをtitleに含む", () => {
    expect(notFoundPageSource).toContain("dictionary.notFound.heading");
    expect(jaDictionarySource).toContain('heading: "ページが見つかりません"');
    expect(enDictionarySource).toContain('heading: "Page not found"');
  });

  it("h1が1つだけあり、dictionary.notFound.headingを表示する", () => {
    const matches = notFoundPageSource.match(/<h1[^>]*>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(notFoundPageSource).toContain("<h1>{dictionary.notFound.heading}</h1>");
  });

  it("canonical・alternateUrls・xDefaultUrlを一切渡さない(404にhreflang/x-default/canonicalを出さない方針)", () => {
    expect(notFoundPageSource).not.toMatch(/canonicalPath=/);
    expect(notFoundPageSource).not.toMatch(/alternateUrls=/);
    expect(notFoundPageSource).not.toMatch(/xDefaultUrl=/);
  });

  it("現localeのホームへの明確なリンクを持つ", () => {
    expect(notFoundPageSource).toContain("homeHref");
    expect(notFoundPageSource).toMatch(/href=\{homeHref\}/);
  });

  it('英語ホーム・日本語ホーム双方への明示リンク(LanguageSwitcher pageKey="default")を持つ(未知パスの相互変換はしない)', () => {
    expect(notFoundPageSource).toMatch(
      /<LanguageSwitcher\s+locale=\{locale\}\s+pageKey="default"\s*\/>/,
    );
  });

  it("画像処理コンポーネント(client:load)を読み込まない", () => {
    expect(notFoundPageSource).not.toContain("client:load");
    expect(notFoundPageSource).not.toMatch(/Workbench/);
  });

  it("lang・viewport・faviconを持つ(BaseLayout経由・既存ページと同等の最低限のhead)", () => {
    expect(notFoundPageSource).toMatch(/<BaseLayout[^>]*\slocale=\{locale\}/s);
    expect(baseLayoutSource).toContain("<html lang={localeDefinition.htmlLang}>");
    expect(baseLayoutSource).toContain('name="viewport"');
    expect(baseLayoutSource).toContain('rel="icon"');
  });
});

describe("404ページは通常のページ一覧・ナビゲーションに追加されていない", () => {
  it("resolveNavItemsは引き続き7件のみで、/404を含まない", () => {
    const items = resolveNavItems("ja", "default");
    expect(items).toHaveLength(7);
    expect(items.map((item) => item.href)).not.toContain("/ja/404");
    expect(items.map((item) => item.href)).not.toContain("/ja/404/");
  });

  it("getToolCardsは引き続き8件のみで、/404を含まない", () => {
    const cards = getToolCards("ja");
    expect(cards).toHaveLength(8);
    expect(cards.map((card) => card.href)).not.toContain("/ja/404/");
  });

  it("resolvePublicPageKeyStrict('/404')は通常ページとして特別扱いされず、nullを返す(defaultへの暗黙fallbackもしない)", () => {
    expect(resolvePublicPageKeyStrict("/404")).toBeNull();
  });

  it("404ページはToolPageLayout/SiteNavを使わないため、current判定を誤って有効化する経路自体が存在しない", () => {
    // NotFoundPageはSiteNavをimportしない設計であることをソースレベルで確認する
    expect(notFoundPageSource).not.toContain("SiteNav");
  });
});

describe("SPA fallback設定(_redirects)が再導入されていないこと", () => {
  const redirectsPath = path.join(process.cwd(), "public/_redirects");

  it("public/_redirectsが存在する場合、全経路を200でindex.htmlへ流すSPA fallbackルールを含まない", () => {
    if (!existsSync(redirectsPath)) {
      expect(existsSync(redirectsPath)).toBe(false);
      return;
    }
    const redirects = readFileSync(redirectsPath, "utf-8");
    expect(redirects).not.toMatch(/\/\*\s+\/index\.html\s+200/);
  });

  it("public/_redirectsが存在する場合、接頭辞なしURLから/ja/への自動言語リダイレクトを含まない", () => {
    if (!existsSync(redirectsPath)) {
      expect(existsSync(redirectsPath)).toBe(false);
      return;
    }
    const redirects = readFileSync(redirectsPath, "utf-8");
    expect(redirects).not.toMatch(/\/ja\/?/);
  });
});
