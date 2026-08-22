import { describe, expect, it } from "vitest";
import {
  PRODUCTION_ORIGIN,
  buildRobotsTxt,
  buildSitemapXml,
  collectPublicationUrls,
  decideSearchPublicationAction,
  escapeXml,
  extractCanonicalHref,
  hasNoindexRobotsMeta,
  isEligiblePublicationUrl,
  isReleaseModeEnabled,
} from "../scripts/lib/search-publication.mjs";
import {
  EXPECTED_PUBLICATION_URL_COUNT,
  INDEXABLE_PAGES,
  SITE_PAGES,
  expandPages,
} from "../scripts/lib/site-pages.mjs";

function pageHtml({
  canonical,
  noindex = true,
}: {
  canonical?: string;
  noindex?: boolean;
}): string {
  const robotsMeta = noindex ? '<meta name="robots" content="noindex, nofollow" />' : "";
  const canonicalTag = canonical ? `<link rel="canonical" href="${canonical}" />` : "";
  return `<!doctype html><html><head>${robotsMeta}${canonicalTag}</head><body></body></html>`;
}

describe('isReleaseModeEnabled — 厳密に文字列"true"のときだけtrue', () => {
  it.each([
    ["true", true],
    [undefined, false],
    ["false", false],
    ["TRUE", false],
    ["1", false],
    ["", false],
    ["yes", false],
  ])("rawValue=%p のとき %p を返す", (rawValue, expected) => {
    expect(isReleaseModeEnabled(rawValue)).toBe(expected);
  });
});

describe("extractCanonicalHref", () => {
  it("canonicalが存在すればhrefを返す", () => {
    expect(
      extractCanonicalHref(pageHtml({ canonical: "https://limifile.com/", noindex: false })),
    ).toBe("https://limifile.com/");
  });

  it("canonicalが存在しなければnullを返す(404ページ相当)", () => {
    expect(extractCanonicalHref(pageHtml({ noindex: true }))).toBeNull();
  });
});

describe("hasNoindexRobotsMeta", () => {
  it("noindex,nofollowを含むページはtrue", () => {
    expect(hasNoindexRobotsMeta(pageHtml({ noindex: true }))).toBe(true);
  });

  it("noindexが無いページはfalse", () => {
    expect(
      hasNoindexRobotsMeta(pageHtml({ noindex: false, canonical: "https://limifile.com/" })),
    ).toBe(false);
  });
});

describe("isEligiblePublicationUrl", () => {
  it("originへの絶対URL・末尾スラッシュ付きはtrue", () => {
    expect(isEligiblePublicationUrl("https://limifile.com/heic-to-jpg/")).toBe(true);
    expect(isEligiblePublicationUrl("https://limifile.com/")).toBe(true);
  });

  it("originが異なる場合はfalse(Preview origin等)", () => {
    expect(
      isEligiblePublicationUrl("https://fixture-preview.limifile.pages.dev/heic-to-jpg/"),
    ).toBe(false);
  });

  it("queryを含む場合はfalse", () => {
    expect(isEligiblePublicationUrl("https://limifile.com/heic-to-jpg/?ref=x")).toBe(false);
  });

  it("hashを含む場合はfalse", () => {
    expect(isEligiblePublicationUrl("https://limifile.com/heic-to-jpg/#section")).toBe(false);
  });

  it("末尾スラッシュが無い場合はfalse", () => {
    expect(isEligiblePublicationUrl("https://limifile.com/heic-to-jpg")).toBe(false);
  });

  it.each([
    "https://limifile.com/licenses/",
    "https://limifile.com/ja/licenses/",
    "https://limifile.com/privacy/",
    "https://limifile.com/ja/privacy/",
    "https://limifile.com/terms/",
    "https://limifile.com/ja/terms/",
    "https://limifile.com/contact/",
    "https://limifile.com/ja/contact/",
    "https://limifile.com/en/",
  ])("trust/licenses/enのURL(%s)はfalse", (url) => {
    expect(isEligiblePublicationUrl(url)).toBe(false);
  });
});

describe("collectPublicationUrls", () => {
  const EN_TOOL_KEYS = [
    "",
    "heic-to-jpg",
    "compress-image",
    "compress-image-to-500kb",
    "remove-exif",
    "png-to-webp",
    "compress-png",
  ];

  function buildFullToolPageEntries(): { distRelPath: string; html: string }[] {
    const entries: { distRelPath: string; html: string }[] = [];
    for (const locale of ["en", "ja"] as const) {
      for (const key of EN_TOOL_KEYS) {
        const prefix = locale === "ja" ? "/ja" : "";
        const pathname = key === "" ? `${prefix}/` : `${prefix}/${key}/`;
        entries.push({
          distRelPath: `dummy-${locale}-${key || "default"}.html`,
          html: pageHtml({ canonical: `${PRODUCTION_ORIGIN}${pathname}`, noindex: false }),
        });
      }
    }
    return entries;
  }

  it("14件の対象ページから、ちょうど14件・期待順序のURLを返す", () => {
    // わざと順序をシャッフルして入力しても、出力は安定した順序になることを確認する。
    const entries = buildFullToolPageEntries().reverse();
    const urls = collectPublicationUrls(entries);
    expect(urls).toEqual([
      `${PRODUCTION_ORIGIN}/`,
      `${PRODUCTION_ORIGIN}/heic-to-jpg/`,
      `${PRODUCTION_ORIGIN}/compress-image/`,
      `${PRODUCTION_ORIGIN}/compress-image-to-500kb/`,
      `${PRODUCTION_ORIGIN}/remove-exif/`,
      `${PRODUCTION_ORIGIN}/png-to-webp/`,
      `${PRODUCTION_ORIGIN}/compress-png/`,
      `${PRODUCTION_ORIGIN}/ja/`,
      `${PRODUCTION_ORIGIN}/ja/heic-to-jpg/`,
      `${PRODUCTION_ORIGIN}/ja/compress-image/`,
      `${PRODUCTION_ORIGIN}/ja/compress-image-to-500kb/`,
      `${PRODUCTION_ORIGIN}/ja/remove-exif/`,
      `${PRODUCTION_ORIGIN}/ja/png-to-webp/`,
      `${PRODUCTION_ORIGIN}/ja/compress-png/`,
    ]);
  });

  it("noindexページは除外する", () => {
    const entries = [
      ...buildFullToolPageEntries(),
      {
        distRelPath: "extra.html",
        html: pageHtml({ canonical: `${PRODUCTION_ORIGIN}/extra/`, noindex: true }),
      },
    ];
    const urls = collectPublicationUrls(entries);
    expect(urls).toHaveLength(14);
    expect(urls).not.toContain(`${PRODUCTION_ORIGIN}/extra/`);
  });

  it("canonicalが無いページ(404相当)は除外する", () => {
    const entries = [
      ...buildFullToolPageEntries(),
      { distRelPath: "404.html", html: pageHtml({ noindex: true }) },
    ];
    const urls = collectPublicationUrls(entries);
    expect(urls).toHaveLength(14);
  });

  it("trust/licensesページ(canonicalありだが実際はindexable=falseで常にnoindex)は除外される", () => {
    const entries = [
      ...buildFullToolPageEntries(),
      {
        distRelPath: "licenses.html",
        html: pageHtml({ canonical: `${PRODUCTION_ORIGIN}/licenses/`, noindex: true }),
      },
    ];
    const urls = collectPublicationUrls(entries);
    expect(urls).toHaveLength(14);
    expect(urls).not.toContain(`${PRODUCTION_ORIGIN}/licenses/`);
  });

  it("同じcanonicalが複数ファイルに現れても重複排除する", () => {
    const entries = buildFullToolPageEntries();
    entries.push({ distRelPath: "dup.html", html: entries[0].html });
    const urls = collectPublicationUrls(entries);
    expect(urls).toHaveLength(14);
    expect(new Set(urls).size).toBe(14);
  });

  it("14件に満たない場合はそのまま少ない件数を返す(呼び出し側のguardに委ねる)", () => {
    const entries = buildFullToolPageEntries().slice(0, 5);
    const urls = collectPublicationUrls(entries);
    expect(urls).toHaveLength(5);
  });
});

describe("collectPublicationUrls — 実サイト構成(SITE_PAGES由来、固定容量4ページ追加後)", () => {
  function buildRealSiteEntries(): { distRelPath: string; html: string }[] {
    return expandPages(INDEXABLE_PAGES, PRODUCTION_ORIGIN).map(
      ({ url, distRel }: { url: string; distRel: string }) => ({
        distRelPath: distRel,
        html: pageHtml({ canonical: url, noindex: false }),
      }),
    );
  }

  it(`${EXPECTED_PUBLICATION_URL_COUNT}件(indexableな15ページ×locale)を返す`, () => {
    const urls = collectPublicationUrls(buildRealSiteEntries());
    expect(urls).toHaveLength(EXPECTED_PUBLICATION_URL_COUNT);
  });

  it("新規4URL(20/50/100/200KB、英語のみ)を含む", () => {
    const urls = collectPublicationUrls(buildRealSiteEntries());
    expect(urls).toContain(`${PRODUCTION_ORIGIN}/compress-image-to-20kb/`);
    expect(urls).toContain(`${PRODUCTION_ORIGIN}/compress-image-to-50kb/`);
    expect(urls).toContain(`${PRODUCTION_ORIGIN}/compress-image-to-100kb/`);
    expect(urls).toContain(`${PRODUCTION_ORIGIN}/compress-image-to-200kb/`);
  });

  it("存在しない日本語版(/ja/compress-image-to-{20,50,100,200}kb/)を含まない", () => {
    const urls = collectPublicationUrls(buildRealSiteEntries());
    expect(urls).not.toContain(`${PRODUCTION_ORIGIN}/ja/compress-image-to-20kb/`);
    expect(urls).not.toContain(`${PRODUCTION_ORIGIN}/ja/compress-image-to-50kb/`);
    expect(urls).not.toContain(`${PRODUCTION_ORIGIN}/ja/compress-image-to-100kb/`);
    expect(urls).not.toContain(`${PRODUCTION_ORIGIN}/ja/compress-image-to-200kb/`);
  });

  it("既存の500KBページはen/ja両方を維持する(回帰確認)", () => {
    const urls = collectPublicationUrls(buildRealSiteEntries());
    expect(urls).toContain(`${PRODUCTION_ORIGIN}/compress-image-to-500kb/`);
    expect(urls).toContain(`${PRODUCTION_ORIGIN}/ja/compress-image-to-500kb/`);
  });

  it("SITE_PAGESの全indexable URLに重複がない", () => {
    const urls = collectPublicationUrls(buildRealSiteEntries());
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("decideSearchPublicationAction", () => {
  it("release-modeでない場合はskip", () => {
    expect(decideSearchPublicationAction(undefined, 14)).toEqual({ action: "skip" });
    expect(decideSearchPublicationAction("false", 14)).toEqual({ action: "skip" });
    expect(decideSearchPublicationAction("TRUE", 14)).toEqual({ action: "skip" });
    expect(decideSearchPublicationAction("1", 14)).toEqual({ action: "skip" });
  });

  it("release-modeでexpectedCountちょうどならgenerate(expectedCountは呼び出し側が明示できる)", () => {
    expect(decideSearchPublicationAction("true", 14, 14)).toEqual({ action: "generate" });
  });

  it("release-modeでexpectedCountでなければfail(理由付き)", () => {
    const result = decideSearchPublicationAction("true", 13, 14);
    expect(result.action).toBe("fail");
    expect(result.reason).toContain("13件");
    expect(result.reason).toContain("14件");
  });

  it("expectedCountを省略すると、サイト全体のEXPECTED_PUBLICATION_URL_COUNT(現在24件: indexableな15ページ×locale)がデフォルトになる", () => {
    expect(decideSearchPublicationAction("true", EXPECTED_PUBLICATION_URL_COUNT)).toEqual({
      action: "generate",
    });
    expect(decideSearchPublicationAction("true", EXPECTED_PUBLICATION_URL_COUNT - 1).action).toBe(
      "fail",
    );
  });
});

describe("EXPECTED_PUBLICATION_URL_COUNT / SITE_PAGES — 実サイトのページ構成を反映する単一の情報源", () => {
  it("24件(indexableな15ページ: en/ja両方9ページ×2 + 英語専用6ページ×1)である", () => {
    expect(EXPECTED_PUBLICATION_URL_COUNT).toBe(24);
  });

  it("固定容量4ページ(20/50/100/200KB)はlocalesが['en']のみである(日本語版を作らない方針)", () => {
    const enOnlySlugs = [
      "compress-image-to-20kb",
      "compress-image-to-50kb",
      "compress-image-to-100kb",
      "compress-image-to-200kb",
    ];
    for (const slug of enOnlySlugs) {
      const page = SITE_PAGES.find((p) => p.slug === slug);
      expect(page?.locales).toEqual(["en"]);
    }
  });

  it("既存の500KBページはlocalesが['en','ja']のままである(回帰確認)", () => {
    const page = SITE_PAGES.find((p) => p.slug === "compress-image-to-500kb");
    expect(page?.locales).toEqual(["en", "ja"]);
  });
});

describe("escapeXml", () => {
  it("&, <, >, \", ' をエスケープする", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("buildSitemapXml", () => {
  it("urlset namespaceとUTF-8宣言を含む", () => {
    const xml = buildSitemapXml([`${PRODUCTION_ORIGIN}/`]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });

  it("各URLを<loc>としてエスケープ済みで出力する", () => {
    const xml = buildSitemapXml([`${PRODUCTION_ORIGIN}/?a=1&b=2`]);
    expect(xml).toContain(`<loc>${PRODUCTION_ORIGIN}/?a=1&amp;b=2</loc>`);
  });

  it("lastmod・changefreq・priority・xhtml:link(hreflang)を一切含まない", () => {
    const xml = buildSitemapXml([`${PRODUCTION_ORIGIN}/`, `${PRODUCTION_ORIGIN}/ja/`]);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("<changefreq>");
    expect(xml).not.toContain("<priority>");
    expect(xml).not.toContain("xhtml:link");
    expect(xml).not.toContain("hreflang");
  });

  it("URLの出力順序を入力順のまま保つ(呼び出し側でソート済みの安定順序を尊重する)", () => {
    const urls = [`${PRODUCTION_ORIGIN}/b/`, `${PRODUCTION_ORIGIN}/a/`];
    const xml = buildSitemapXml(urls);
    const locOrder = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locOrder).toEqual(urls);
  });
});

describe("buildRobotsTxt", () => {
  it("User-agent: * / Allow: / / 空行 / Sitemap directiveを含み、Disallow: /を含まない", () => {
    const robots = buildRobotsTxt(`${PRODUCTION_ORIGIN}/sitemap.xml`);
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain(`Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`);
    expect(robots).not.toMatch(/Disallow:\s*\//);
  });
});
