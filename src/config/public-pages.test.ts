import { describe, expect, it } from "vitest";
import {
  PUBLIC_PAGE_KEYS,
  buildLocalizedPagePath,
  buildLocalizedPageUrl,
  buildPageAlternateUrls,
  buildXDefaultUrl,
  getLocalesForPage,
  getPagePathnameWithoutLocale,
  isEnOnlyPage,
  resolvePublicPageKeyStrict,
} from "./public-pages";
import type { PublicPageKey } from "./public-pages";

const origin = "https://limifile.com";

/** 英語版のみ公開するページ(固定容量4ページ・avif-to-jpg・signature-resizer) */
const EN_ONLY_KEYS: PublicPageKey[] = [
  "compress-image-to-20kb",
  "compress-image-to-50kb",
  "compress-image-to-100kb",
  "compress-image-to-200kb",
  "avif-to-jpg",
  "signature-resizer",
];

describe("PUBLIC_PAGE_KEYS", () => {
  it("全19key(トップ+ツール14+licenses+privacy+terms+contact)を持つ", () => {
    expect(PUBLIC_PAGE_KEYS).toHaveLength(19);
    expect(PUBLIC_PAGE_KEYS).toContain("default");
    expect(PUBLIC_PAGE_KEYS).toContain("compress-image-to-500kb");
    for (const key of EN_ONLY_KEYS) {
      expect(PUBLIC_PAGE_KEYS).toContain(key);
    }
    expect(PUBLIC_PAGE_KEYS).toContain("licenses");
    expect(PUBLIC_PAGE_KEYS).toContain("privacy");
    expect(PUBLIC_PAGE_KEYS).toContain("terms");
    expect(PUBLIC_PAGE_KEYS).toContain("contact");
  });

  it("重複するkeyが無い", () => {
    expect(new Set(PUBLIC_PAGE_KEYS).size).toBe(PUBLIC_PAGE_KEYS.length);
  });
});

describe("isEnOnlyPage / getLocalesForPage", () => {
  it("固定容量20/50/100/200KBページは英語版のみ実在する", () => {
    for (const key of EN_ONLY_KEYS) {
      expect(isEnOnlyPage(key)).toBe(true);
      expect(getLocalesForPage(key)).toEqual(["en"]);
    }
  });

  it("既存ページ(500KB含む)はen/ja両方が実在する", () => {
    const existingKeys: PublicPageKey[] = [
      "default",
      "heic-to-jpg",
      "compress-image",
      "compress-image-to-500kb",
      "remove-exif",
      "png-to-webp",
      "compress-png",
      "png-to-jpg",
      "webp-to-jpg",
      "licenses",
      "privacy",
      "terms",
      "contact",
    ];
    for (const key of existingKeys) {
      expect(isEnOnlyPage(key)).toBe(false);
      expect(getLocalesForPage(key)).toEqual(["en", "ja"]);
    }
  });

  it("全PublicPageKeyについて、getLocalesForPageは常に'en'を含む(DEFAULT_LOCALE)", () => {
    for (const key of PUBLIC_PAGE_KEYS) {
      expect(getLocalesForPage(key)).toContain("en");
    }
  });
});

describe("getPagePathnameWithoutLocale", () => {
  it("トップは'/'を返す", () => {
    expect(getPagePathnameWithoutLocale("default")).toBe("/");
  });

  it("licensesは'/licenses'を返す(末尾スラッシュ無し、locale prefix無し)", () => {
    expect(getPagePathnameWithoutLocale("licenses")).toBe("/licenses");
  });

  it("全19keyで重複しないpathnameを持つ", () => {
    const pathnames = PUBLIC_PAGE_KEYS.map((key) => getPagePathnameWithoutLocale(key));
    expect(new Set(pathnames).size).toBe(pathnames.length);
  });

  it("privacy/terms/contactはそれぞれ/privacy・/terms・/contactを返す", () => {
    expect(getPagePathnameWithoutLocale("privacy")).toBe("/privacy");
    expect(getPagePathnameWithoutLocale("terms")).toBe("/terms");
    expect(getPagePathnameWithoutLocale("contact")).toBe("/contact");
  });
});

describe("buildLocalizedPagePath", () => {
  it("en rootは'/'", () => {
    expect(buildLocalizedPagePath("en", "default")).toBe("/");
  });

  it("ja rootは'/ja/'", () => {
    expect(buildLocalizedPagePath("ja", "default")).toBe("/ja/");
  });

  it("en toolは末尾スラッシュ付き・prefix無し", () => {
    expect(buildLocalizedPagePath("en", "heic-to-jpg")).toBe("/heic-to-jpg/");
  });

  it("ja toolは/jaをprefixし、末尾スラッシュ付き", () => {
    expect(buildLocalizedPagePath("ja", "heic-to-jpg")).toBe("/ja/heic-to-jpg/");
  });

  it("licensesもen/jaで末尾スラッシュ付き公開URLを返す", () => {
    expect(buildLocalizedPagePath("en", "licenses")).toBe("/licenses/");
    expect(buildLocalizedPagePath("ja", "licenses")).toBe("/ja/licenses/");
  });

  it("privacy/terms/contactはen/jaで末尾スラッシュ付き公開URLを返す", () => {
    expect(buildLocalizedPagePath("en", "privacy")).toBe("/privacy/");
    expect(buildLocalizedPagePath("ja", "privacy")).toBe("/ja/privacy/");
    expect(buildLocalizedPagePath("en", "terms")).toBe("/terms/");
    expect(buildLocalizedPagePath("ja", "terms")).toBe("/ja/terms/");
    expect(buildLocalizedPagePath("en", "contact")).toBe("/contact/");
    expect(buildLocalizedPagePath("ja", "contact")).toBe("/ja/contact/");
  });

  it("固定容量20/50/100/200KBページは英語版のURLのみを持つ", () => {
    expect(buildLocalizedPagePath("en", "compress-image-to-20kb")).toBe("/compress-image-to-20kb/");
    expect(buildLocalizedPagePath("en", "compress-image-to-200kb")).toBe(
      "/compress-image-to-200kb/",
    );
  });

  it("実在するlocaleの組み合わせだけで、重複しない32件の公開URLを生成する(19key、うち6keyは英語のみ)", () => {
    const paths = PUBLIC_PAGE_KEYS.flatMap((key) =>
      getLocalesForPage(key).map((locale) => buildLocalizedPagePath(locale, key)),
    );
    expect(paths).toHaveLength(32);
    expect(new Set(paths).size).toBe(32);
    for (const p of paths) {
      expect(p === "/" || p.endsWith("/")).toBe(true);
      expect(p).not.toMatch(/\/\//);
    }
  });
});

describe("buildLocalizedPageUrl", () => {
  it("originと組み合わせて絶対URLを生成する", () => {
    expect(buildLocalizedPageUrl(origin, "en", "heic-to-jpg")).toBe(
      "https://limifile.com/heic-to-jpg/",
    );
    expect(buildLocalizedPageUrl(origin, "ja", "heic-to-jpg")).toBe(
      "https://limifile.com/ja/heic-to-jpg/",
    );
  });
});

describe("buildPageAlternateUrls", () => {
  it("en・jaの2件を、自ページを含めて相互に生成する", () => {
    const alternates = buildPageAlternateUrls(origin, "heic-to-jpg");
    expect(alternates).toEqual([
      { locale: "en", hreflang: "en", href: "https://limifile.com/heic-to-jpg/" },
      { locale: "ja", hreflang: "ja", href: "https://limifile.com/ja/heic-to-jpg/" },
    ]);
  });

  it("reserved locale(es/pt-BR/de/fr)を含まない", () => {
    const alternates = buildPageAlternateUrls(origin, "default");
    const locales = alternates.map((a) => a.locale);
    expect(locales).toEqual(["en", "ja"]);
  });

  it("licensesページでも同様にen/ja2件を生成する", () => {
    const alternates = buildPageAlternateUrls(origin, "licenses");
    expect(alternates).toHaveLength(2);
  });

  it("privacy/terms/contactでもen/ja2件を生成し、reserved localeを含まない", () => {
    for (const key of ["privacy", "terms", "contact"] as const) {
      const alternates = buildPageAlternateUrls(origin, key);
      expect(alternates.map((a) => a.locale)).toEqual(["en", "ja"]);
    }
  });

  it("固定容量20/50/100/200KBページはen1件のみを生成し、jaを含まない(日本語版が存在しないため)", () => {
    for (const key of [
      "compress-image-to-20kb",
      "compress-image-to-50kb",
      "compress-image-to-100kb",
      "compress-image-to-200kb",
    ] as const) {
      const alternates = buildPageAlternateUrls(origin, key);
      expect(alternates).toEqual([
        { locale: "en", hreflang: "en", href: `https://limifile.com/${key}/` },
      ]);
    }
  });
});

describe("buildXDefaultUrl", () => {
  it("常に英語版(既定言語)のURLを返す", () => {
    expect(buildXDefaultUrl(origin, "heic-to-jpg")).toBe("https://limifile.com/heic-to-jpg/");
    expect(buildXDefaultUrl(origin, "default")).toBe("https://limifile.com/");
    expect(buildXDefaultUrl(origin, "licenses")).toBe("https://limifile.com/licenses/");
  });
});

describe("resolvePublicPageKeyStrict", () => {
  it("既知のpathnameは対応するPublicPageKeyを返す", () => {
    expect(resolvePublicPageKeyStrict("/")).toBe("default");
    expect(resolvePublicPageKeyStrict("/heic-to-jpg")).toBe("heic-to-jpg");
    expect(resolvePublicPageKeyStrict("/heic-to-jpg/")).toBe("heic-to-jpg");
    expect(resolvePublicPageKeyStrict("/licenses")).toBe("licenses");
  });

  it("未知のpathnameはdefaultへ暗黙にfallbackせずnullを返す", () => {
    expect(resolvePublicPageKeyStrict("/404")).toBeNull();
    expect(resolvePublicPageKeyStrict("/unknown-page")).toBeNull();
  });

  it("全PublicPageKeyについて、pathname往復で自分自身に解決する", () => {
    for (const key of PUBLIC_PAGE_KEYS) {
      const pathname = getPagePathnameWithoutLocale(key);
      expect(resolvePublicPageKeyStrict(pathname)).toBe(key satisfies PublicPageKey);
    }
  });
});
