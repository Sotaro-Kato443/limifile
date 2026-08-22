import { describe, expect, it } from "vitest";
import {
  buildAbsoluteUrl,
  buildAlternateUrls,
  buildCanonicalUrl,
  buildLocalizedPathname,
  buildLocalizedUrl,
  buildPublicAbsoluteUrl,
  getLocalePrefix,
  normalizePathname,
  stripLocalePrefix,
  toPublicPathname,
} from "./urls";
import type { LocaleKey } from "./locales";

describe("normalizePathname", () => {
  it("ルートはそのまま/を返す", () => {
    expect(normalizePathname("/")).toBe("/");
  });

  it("末尾のスラッシュを取り除く", () => {
    expect(normalizePathname("/heic-to-jpg/")).toBe("/heic-to-jpg");
  });

  it("末尾の連続スラッシュもまとめて取り除く", () => {
    expect(normalizePathname("/heic-to-jpg///")).toBe("/heic-to-jpg");
  });

  it("先頭にスラッシュが無ければ補う", () => {
    expect(normalizePathname("heic-to-jpg")).toBe("/heic-to-jpg");
  });

  it("queryを取り除く", () => {
    expect(normalizePathname("/heic-to-jpg?ref=twitter")).toBe("/heic-to-jpg");
  });

  it("hashを取り除く", () => {
    expect(normalizePathname("/heic-to-jpg#section")).toBe("/heic-to-jpg");
  });

  it("queryとhashが両方あっても取り除く", () => {
    expect(normalizePathname("/heic-to-jpg?ref=x#section")).toBe("/heic-to-jpg");
  });

  it("空文字は/として扱う", () => {
    expect(normalizePathname("")).toBe("/");
  });
});

describe("getLocalePrefix", () => {
  it("既定言語(en)は空文字", () => {
    expect(getLocalePrefix("en")).toBe("");
  });

  it("jaは'ja'", () => {
    expect(getLocalePrefix("ja")).toBe("ja");
  });

  it("pt-BRは'pt-br'(HTML langの'pt-BR'とは異なる表記)", () => {
    expect(getLocalePrefix("pt-BR")).toBe("pt-br");
  });
});

describe("stripLocalePrefix", () => {
  it("'/'は既定言語(en)の'/'", () => {
    expect(stripLocalePrefix("/")).toEqual({ locale: "en", pathname: "/" });
  });

  it("prefix無しのpathnameは既定言語(en)として扱う", () => {
    expect(stripLocalePrefix("/heic-to-jpg")).toEqual({ locale: "en", pathname: "/heic-to-jpg" });
  });

  it("'/ja/'はjaの'/'", () => {
    expect(stripLocalePrefix("/ja/")).toEqual({ locale: "ja", pathname: "/" });
  });

  it("'/ja/heic-to-jpg'はjaの'/heic-to-jpg'", () => {
    expect(stripLocalePrefix("/ja/heic-to-jpg")).toEqual({
      locale: "ja",
      pathname: "/heic-to-jpg",
    });
  });

  it("'/pt-br/heic-to-jpg'は現時点では未有効ロケールのため、既定言語のpathnameとして扱う", () => {
    // pt-BRはPR A1時点でACTIVE_LOCALESに含まれないため、"pt-br"はlocaleのprefixとして
    // 認識されず、パス全体がそのまま既定言語(en)のpathnameとして解決される。
    expect(stripLocalePrefix("/pt-br/heic-to-jpg")).toEqual({
      locale: "en",
      pathname: "/pt-br/heic-to-jpg",
    });
  });

  it("末尾スラッシュがあっても正規化してから解決する", () => {
    expect(stripLocalePrefix("/ja/heic-to-jpg/")).toEqual({
      locale: "ja",
      pathname: "/heic-to-jpg",
    });
  });
});

describe("buildLocalizedPathname", () => {
  it("enは常にprefix無し", () => {
    expect(buildLocalizedPathname("en", "/")).toBe("/");
    expect(buildLocalizedPathname("en", "/heic-to-jpg")).toBe("/heic-to-jpg");
  });

  it("jaは/jaをprefixする", () => {
    expect(buildLocalizedPathname("ja", "/")).toBe("/ja");
    expect(buildLocalizedPathname("ja", "/heic-to-jpg")).toBe("/ja/heic-to-jpg");
  });

  it("pt-BRは/pt-brをprefixする(HTML langのpt-BRとは異なる表記)", () => {
    expect(buildLocalizedPathname("pt-BR", "/heic-to-jpg")).toBe("/pt-br/heic-to-jpg");
  });
});

describe("buildAbsoluteUrl / buildLocalizedUrl / buildCanonicalUrl", () => {
  const origin = "https://limifile.com";

  it("buildAbsoluteUrlはoriginとpathnameを結合する", () => {
    expect(buildAbsoluteUrl(origin, "/heic-to-jpg")).toBe("https://limifile.com/heic-to-jpg");
  });

  it("originの末尾スラッシュは重複しない", () => {
    expect(buildAbsoluteUrl(`${origin}/`, "/heic-to-jpg")).toBe("https://limifile.com/heic-to-jpg");
  });

  it("buildLocalizedUrlはlocaleのprefixを含めて絶対URLを生成する", () => {
    expect(buildLocalizedUrl(origin, "ja", "/heic-to-jpg")).toBe(
      "https://limifile.com/ja/heic-to-jpg",
    );
    expect(buildLocalizedUrl(origin, "en", "/heic-to-jpg")).toBe(
      "https://limifile.com/heic-to-jpg",
    );
  });

  it("buildCanonicalUrlはbuildLocalizedUrlと同じ結果を返す", () => {
    expect(buildCanonicalUrl(origin, "ja", "/")).toBe(buildLocalizedUrl(origin, "ja", "/"));
    expect(buildCanonicalUrl(origin, "ja", "/")).toBe("https://limifile.com/ja");
  });

  it("query/hashはcanonical URLに含まれない", () => {
    expect(buildCanonicalUrl(origin, "en", "/heic-to-jpg?ref=x#section")).toBe(
      "https://limifile.com/heic-to-jpg",
    );
  });
});

describe("buildAlternateUrls", () => {
  const origin = "https://limifile.com";

  it("渡したlocale一覧の分だけURLを生成する", () => {
    const alternates = buildAlternateUrls(origin, "/heic-to-jpg", ["en", "ja"]);
    expect(alternates).toEqual([
      { locale: "en", hreflang: "en", href: "https://limifile.com/heic-to-jpg" },
      { locale: "ja", hreflang: "ja", href: "https://limifile.com/ja/heic-to-jpg" },
    ]);
  });

  it("空配列を渡せば空配列を返す(実在する翻訳が無ければ何も出力しない用途)", () => {
    expect(buildAlternateUrls(origin, "/heic-to-jpg", [])).toEqual([]);
  });
});

describe("toPublicPathname — ルート照合用pathnameと公開URL用pathnameの責務分離", () => {
  it("'/' はそのまま'/'", () => {
    expect(toPublicPathname("/")).toBe("/");
  });

  it("'/heic-to-jpg' は末尾スラッシュ付きの公開URLになる", () => {
    expect(toPublicPathname("/heic-to-jpg")).toBe("/heic-to-jpg/");
  });

  it("末尾スラッシュ付きで渡しても、正規化してから1つだけ付け直す(二重スラッシュにならない)", () => {
    expect(toPublicPathname("/heic-to-jpg/")).toBe("/heic-to-jpg/");
  });

  it("'/ja' は '/ja/' になる", () => {
    expect(toPublicPathname("/ja")).toBe("/ja/");
  });

  it("'/ja/heic-to-jpg' は '/ja/heic-to-jpg/' になる", () => {
    expect(toPublicPathname("/ja/heic-to-jpg")).toBe("/ja/heic-to-jpg/");
  });

  it("query/hash付きで渡されても除去してから末尾スラッシュを付与する", () => {
    expect(toPublicPathname("/heic-to-jpg?ref=x#section")).toBe("/heic-to-jpg/");
  });
});

describe("buildPublicAbsoluteUrl", () => {
  const origin = "https://limifile.com";

  it("公開URL用pathname(末尾スラッシュ込み)をそのまま結合し、再正規化(末尾スラッシュ除去)しない", () => {
    expect(buildPublicAbsoluteUrl(origin, toPublicPathname("/heic-to-jpg"))).toBe(
      "https://limifile.com/heic-to-jpg/",
    );
    expect(buildPublicAbsoluteUrl(origin, "/")).toBe("https://limifile.com/");
  });

  it("originの末尾スラッシュは重複しない", () => {
    expect(buildPublicAbsoluteUrl(`${origin}/`, "/heic-to-jpg/")).toBe(
      "https://limifile.com/heic-to-jpg/",
    );
  });
});

describe("不正入力の扱い", () => {
  it("未知のlocale keyをbuildLocalizedPathnameに渡すと例外を投げる", () => {
    expect(() => buildLocalizedPathname("xx" as LocaleKey, "/heic-to-jpg")).toThrow(
      /Unknown locale key/,
    );
  });
});
