import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "./brand";
import { getToolCards, getToolDefinition, resolveNavItems } from "./tool-page-config";
import type { LocalizedToolPageKey, ToolPageKey } from "./tool-page-config";
import { getToolContent } from "../i18n/get-tool-content";
import { RESERVED_LOCALES } from "../i18n/locales";

/** 全13 ToolPageKey(トップ+ツール12、うち固定容量4件は英語専用) */
const ALL_KEYS: ToolPageKey[] = [
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
];

/** en/ja両方が実在する9 ToolPageKey(既存ページのみ、日本語コンテンツのテストに使う) */
const LOCALIZED_KEYS: LocalizedToolPageKey[] = [
  "default",
  "heic-to-jpg",
  "compress-image",
  "compress-image-to-500kb",
  "remove-exif",
  "png-to-webp",
  "compress-png",
  "png-to-jpg",
  "webp-to-jpg",
];

/** 英語版のみ実在する4 ToolPageKey(日本語版は意図的に作らない) */
const EN_ONLY_KEYS: ToolPageKey[] = [
  "compress-image-to-20kb",
  "compress-image-to-50kb",
  "compress-image-to-100kb",
  "compress-image-to-200kb",
];

describe("getToolDefinition(locale非依存)", () => {
  it("トップページはindex可能な標準定義を返す", () => {
    expect(getToolDefinition("default").indexable).toBe(true);
  });

  it("12のツールページ(固定容量4件含む)はpage-levelでindex可能(indexable=true)を返す", () => {
    const keys: ToolPageKey[] = ALL_KEYS.filter((key) => key !== "default");
    for (const key of keys) {
      expect(getToolDefinition(key).indexable).toBe(true);
    }
  });

  it("全13keyのlocale非依存定義(key・indexable)を持つ", () => {
    for (const key of ALL_KEYS) {
      const definition = getToolDefinition(key);
      expect(definition.key).toBe(key);
      expect(typeof definition.indexable).toBe("boolean");
    }
  });

  it("en/ja問わず、同じkeyは同じindexable設定を共有する(localeに依存しない)", () => {
    // getToolDefinitionはlocaleを引数に取らないため、この性質は型シグネチャ自体で保証されるが、
    // 明示的にkeyだけからindexableが一意に決まることをここでも確認する。
    for (const key of ALL_KEYS) {
      expect(getToolDefinition(key)).toBe(getToolDefinition(key));
    }
  });
});

describe("getToolContent(locale, key) — jaは現在値を維持", () => {
  it("/compress-pngはtitle/description/h1(heading)相当の文言を持つ", () => {
    const content = getToolContent("ja", "compress-png");
    expect(content.heading).toBe("PNG画像を指定容量に圧縮");
    expect(content.description).toBe(
      "PNG画像をPNGのまま、指定したKB・MB以下を目指してブラウザ内で圧縮。透過対応・アップロード不要。",
    );
  });

  it("/compress-image-to-500kbはPNGを含む対応形式・説明を持つ(PNG統合後)", () => {
    const content = getToolContent("ja", "compress-image-to-500kb");
    expect(content.formats).toContain("PNG");
    expect(content.description).toContain("PNG");
  });

  it("/compress-imageはPNG統合の対象外のまま(formats・descriptionにPNGを含まない)", () => {
    const content = getToolContent("ja", "compress-image");
    expect(content.formats).toBe("JPEG・HEIC・WebP");
    expect(content.description).not.toContain("PNG");
  });

  it("enでも全13key(固定容量4件含む)のToolContentが存在し、必須文言が空でない", () => {
    for (const key of ALL_KEYS) {
      const content = getToolContent("en", key);
      expect(content.heading.length).toBeGreaterThan(0);
      expect(content.description.length).toBeGreaterThan(0);
      expect(content.navLabel.length).toBeGreaterThan(0);
      expect(content.cardTitle.length).toBeGreaterThan(0);
      expect(content.cardDescription.length).toBeGreaterThan(0);
      expect(content.formats.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveNavItems(locale, currentKey)", () => {
  it("トップ+6ツール、合計7件のリンクを返す(en: prefix無し・末尾スラッシュ付き)", () => {
    const items = resolveNavItems("en", "default");
    expect(items).toHaveLength(7);
    expect(items.map((item) => item.href)).toEqual([
      "/",
      "/heic-to-jpg/",
      "/compress-image/",
      "/compress-image-to-500kb/",
      "/remove-exif/",
      "/png-to-webp/",
      "/compress-png/",
    ]);
  });

  it("ja: /jaをprefixし、末尾スラッシュ付きのhrefを返す", () => {
    const items = resolveNavItems("ja", "default");
    expect(items.map((item) => item.href)).toEqual([
      "/ja/",
      "/ja/heic-to-jpg/",
      "/ja/compress-image/",
      "/ja/compress-image-to-500kb/",
      "/ja/remove-exif/",
      "/ja/png-to-webp/",
      "/ja/compress-png/",
    ]);
  });

  it("currentKeyに対応する項目だけcurrent=trueになる", () => {
    const items = resolveNavItems("ja", "compress-image");
    const currentItems = items.filter((item) => item.current);
    expect(currentItems).toHaveLength(1);
    expect(currentItems[0].href).toBe("/ja/compress-image/");
  });

  it("各項目は簡潔なnavLabel(ja)を持つ(ナビゲーション内で長すぎない)", () => {
    const items = resolveNavItems("ja", "default");
    const labels = items.map((item) => item.label);
    expect(labels).toEqual([
      "トップ",
      "HEIC→JPG",
      "容量指定圧縮",
      "500KB圧縮",
      "メタデータ削除",
      "PNG→WebP",
      "PNG容量圧縮",
    ]);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(8);
    }
  });

  it("en localeでも同じ現在地解決を返す(navLabelとhrefのlocale prefixのみ変わる)", () => {
    const jaItems = resolveNavItems("ja", "compress-image");
    const enItems = resolveNavItems("en", "compress-image");
    expect(enItems.map((item) => item.current)).toEqual(jaItems.map((item) => item.current));
    expect(enItems.map((item) => item.href)).toEqual([
      "/",
      "/heic-to-jpg/",
      "/compress-image/",
      "/compress-image-to-500kb/",
      "/remove-exif/",
      "/png-to-webp/",
      "/compress-png/",
    ]);
    for (const item of enItems) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});

describe("getToolCards(locale)", () => {
  it("トップページ自体を含まない8件のカードを返す", () => {
    const cards = getToolCards("ja");
    expect(cards).toHaveLength(8);
    expect(cards.map((c) => c.key)).not.toContain("default");
  });

  it("jaでは英語専用ページ(avif-to-jpg)をカードに含めない(getToolContentが例外を投げる組み合わせを避ける)", () => {
    const cards = getToolCards("ja");
    expect(cards.map((c) => c.key)).not.toContain("avif-to-jpg");
  });

  it("enでは英語専用ページ(avif-to-jpg)もカードに含める", () => {
    const cards = getToolCards("en");
    expect(cards.map((c) => c.key)).toContain("avif-to-jpg");
  });

  it("各カードはhref(末尾スラッシュ付き)・title・description・formatsを持つ", () => {
    for (const card of getToolCards("ja")) {
      expect(card.href.startsWith("/")).toBe(true);
      expect(card.href.endsWith("/")).toBe(true);
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
      expect(card.formats.length).toBeGreaterThan(0);
    }
  });

  it("ja localeのカードは/ja/配下のhrefを持つ", () => {
    for (const card of getToolCards("ja")) {
      expect(card.href.startsWith("/ja/")).toBe(true);
    }
  });

  it("en localeのカードはprefix無しのhrefを持つ", () => {
    for (const card of getToolCards("en")) {
      expect(card.href.startsWith("/ja/")).toBe(false);
    }
  });

  it("メタデータ削除カードは未実装機能を利用可能であるように表示しない(対応形式がJPEG・HEICのみ)", () => {
    const card = getToolCards("ja").find((c) => c.href === "/ja/remove-exif/");
    expect(card?.formats).toBe("JPEG・HEIC");
  });

  it("PNG→WebP変換カードは対応形式がPNGのみである", () => {
    const card = getToolCards("ja").find((c) => c.href === "/ja/png-to-webp/");
    expect(card?.formats).toBe("PNG");
    expect(card?.title).toBe("PNGをWebPに変換");
  });

  it("PNG指定容量圧縮カードは対応形式がPNGのみである", () => {
    const card = getToolCards("ja").find((c) => c.href === "/ja/compress-png/");
    expect(card?.formats).toBe("PNG");
    expect(card?.title).toBe("PNGを指定容量に圧縮");
  });

  it("PNG→JPG変換カードは対応形式がPNGのみである", () => {
    const card = getToolCards("ja").find((c) => c.href === "/ja/png-to-jpg/");
    expect(card?.formats).toBe("PNG");
    expect(card?.title).toBe("PNGをJPGに変換");
  });

  it("WebP→JPG変換カードは対応形式がWebPのみである", () => {
    const card = getToolCards("ja").find((c) => c.href === "/ja/webp-to-jpg/");
    expect(card?.formats).toBe("WebP");
    expect(card?.title).toBe("WebPをJPGに変換");
  });

  it("en localeでは10件のカードを返し(avif-to-jpg・signature-resizer等の英語専用ページ含む)、必須文言が空でない", () => {
    const cards = getToolCards("en");
    expect(cards).toHaveLength(10);
    for (const card of cards) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
      expect(card.formats.length).toBeGreaterThan(0);
    }
  });
});

describe("seoTitle — 22ページ(en 13key + ja 9key)でtitle・descriptionが重複しない", () => {
  it("en 13件・ja 9件、それぞれseoTitleが重複しない", () => {
    const enTitles = ALL_KEYS.map((key) => getToolContent("en", key).seoTitle);
    expect(new Set(enTitles).size).toBe(enTitles.length);
    const jaTitles = LOCALIZED_KEYS.map((key) => getToolContent("ja", key).seoTitle);
    expect(new Set(jaTitles).size).toBe(jaTitles.length);
  });

  it("en 13件・ja 9件、それぞれdescription(meta description)が重複しない", () => {
    const enDescriptions = ALL_KEYS.map((key) => getToolContent("en", key).description);
    expect(new Set(enDescriptions).size).toBe(enDescriptions.length);
    const jaDescriptions = LOCALIZED_KEYS.map((key) => getToolContent("ja", key).description);
    expect(new Set(jaDescriptions).size).toBe(jaDescriptions.length);
  });

  it("全22件のseoTitleがLimiFileブランドを末尾に1回だけ含む", () => {
    for (const key of ALL_KEYS) {
      const { seoTitle } = getToolContent("en", key);
      expect(seoTitle.endsWith(`| ${BRAND_NAME}`)).toBe(true);
      expect(seoTitle.match(new RegExp(BRAND_NAME, "g"))?.length).toBe(1);
      expect(seoTitle.length).toBeLessThanOrEqual(70);
    }
    for (const key of LOCALIZED_KEYS) {
      const { seoTitle } = getToolContent("ja", key);
      expect(seoTitle.endsWith(`| ${BRAND_NAME}`)).toBe(true);
      expect(seoTitle.match(new RegExp(BRAND_NAME, "g"))?.length).toBe(1);
      expect(seoTitle.length).toBeLessThanOrEqual(70);
    }
  });

  it("seoTitleとheading(h1)は完全一致でなくてよいが、どちらも空でない", () => {
    for (const key of ALL_KEYS) {
      const content = getToolContent("en", key);
      expect(content.seoTitle.length).toBeGreaterThan(0);
      expect(content.heading.length).toBeGreaterThan(0);
    }
    for (const key of LOCALIZED_KEYS) {
      const content = getToolContent("ja", key);
      expect(content.seoTitle.length).toBeGreaterThan(0);
      expect(content.heading.length).toBeGreaterThan(0);
    }
  });

  it("固定容量4ページ(20/50/100/200KB)のseoTitleは「resize」と「compress」の両方の検索意図を反映し、他ページと重複しない", () => {
    expect(getToolContent("en", "compress-image-to-20kb").seoTitle).toBe(
      "Compress & Resize Image to 20KB | LimiFile",
    );
    expect(getToolContent("en", "compress-image-to-50kb").seoTitle).toBe(
      "Compress & Resize Image to 50KB | LimiFile",
    );
    expect(getToolContent("en", "compress-image-to-100kb").seoTitle).toBe(
      "Compress & Resize Image to 100KB | LimiFile",
    );
    expect(getToolContent("en", "compress-image-to-200kb").seoTitle).toBe(
      "Compress & Resize Image to 200KB | LimiFile",
    );
    for (const key of [
      "compress-image-to-20kb",
      "compress-image-to-50kb",
      "compress-image-to-100kb",
      "compress-image-to-200kb",
    ] as const) {
      expect(getToolContent("en", key).seoTitle.toLowerCase()).toContain("resize");
      expect(getToolContent("en", key).seoTitle.toLowerCase()).toContain("compress");
    }
  });

  it("compress-imageのseoTitle・descriptionも「resize image in KB」の検索意図を反映する", () => {
    const content = getToolContent("en", "compress-image");
    expect(content.seoTitle.toLowerCase()).toContain("resize");
    expect(content.description.toLowerCase()).toContain("resize");
  });
});

describe("EN_ONLY_KEYS(固定容量20/50/100/200KB) — 日本語版を意図的に作らない", () => {
  it("EN_ONLY_KEYSはLOCALIZED_KEYSと重複しない", () => {
    for (const key of EN_ONLY_KEYS) {
      expect(LOCALIZED_KEYS).not.toContain(key);
    }
  });

  it("ALL_KEYSはLOCALIZED_KEYSとEN_ONLY_KEYSの和集合と一致する", () => {
    expect(new Set(ALL_KEYS)).toEqual(new Set([...LOCALIZED_KEYS, ...EN_ONLY_KEYS]));
  });
});

describe("getToolContent — 不正なlocale/key組み合わせは明示的にthrowする(castによるundefinedの黙殺はしない)", () => {
  it.each(EN_ONLY_KEYS)('locale="ja"に英語専用key"%s"を渡すと説明的なErrorをthrowする', (key) => {
    expect(() => getToolContent("ja", key)).toThrow(/has no Japanese content|English-only page/);
  });

  it("エラーメッセージに該当keyが含まれる(デバッグしやすくするため)", () => {
    expect(() => getToolContent("ja", "compress-image-to-20kb")).toThrow(/compress-image-to-20kb/);
  });

  it('locale="en"では同じkeyで正常にToolContentを返す(回帰確認)', () => {
    for (const key of EN_ONLY_KEYS) {
      expect(() => getToolContent("en", key)).not.toThrow();
    }
  });
});

describe("reserved localeはroute生成対象にならない(getToolContentの型はImplementedLocaleKeyのみ受け付ける)", () => {
  it("RESERVED_LOCALES(es/pt-BR/de/fr)はgetToolContent/getToolCards/resolveNavItemsの引数型に含まれない", () => {
    // 型レベルの保証(ImplementedLocaleKey = "en" | "ja")をコンパイル時に強制しているため、
    // 実行時テストとしては「RESERVED_LOCALESが依然としてenabledでない」ことのみ確認する。
    expect(RESERVED_LOCALES.every((locale) => !locale.isEnabled)).toBe(true);
  });
});
