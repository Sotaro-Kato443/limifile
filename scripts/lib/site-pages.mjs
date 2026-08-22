/**
 * サイト全体の公開ページ(locale可用性・indexable可否)のmanifest。
 *
 * このリポジトリのbuildスクリプト(plain ESM、TypeScriptを直接importできない — Node組み込みの
 * ts-node/tsx等を追加導入していないため)側で、src/config/public-pages.tsのPublicPageKey・
 * getLocalesForPage・src/config/tool-page-config.tsのTOOL_DEFINITIONS(indexable)と同じ内容を
 * 使うための転記版。test/site-pages-manifest.test.tsで、TypeScript側の実装(実行時に読み込める
 * 唯一の正)と完全一致することをクロスチェックする — 乖離した場合はそのテストが失敗するため、
 * 「ページを追加したのにこのmanifestの更新を忘れる」ことはCIで検出できる。
 *
 * scripts/lib/search-publication.mjs・scripts/verify-search-publication.mjs・
 * scripts/verify-tool-seo-content.mjs・scripts/verify-i18n-seo-foundation.mjsは、
 * それぞれ独自にページ一覧をハードコードするのではなく、この配列を単一の情報源として使う。
 */

/**
 * @typedef {Object} SitePageManifestEntry
 * @property {string} key - PublicPageKey(TypeScript側と同じ文字列)
 * @property {string} slug - locale非依存のpathname("/"を除いた末尾スラッシュ無しのセグメント。トップは"")
 * @property {boolean} isTool - ツールナビゲーション・ToolPageLayoutの対象か(トップ含む)。falseはlicenses/privacy/terms/contact
 * @property {boolean} indexable - ページ単位のindexable設定(サイト全体ゲートとのAND条件は別途)
 * @property {readonly ("en"|"ja")[]} locales - このページが実在するlocaleの一覧(常に1件以上、"en"を含む)
 */

/** @type {readonly SitePageManifestEntry[]} */
export const SITE_PAGES = [
  { key: "default", slug: "", isTool: true, indexable: true, locales: ["en", "ja"] },
  { key: "heic-to-jpg", slug: "heic-to-jpg", isTool: true, indexable: true, locales: ["en", "ja"] },
  {
    key: "compress-image",
    slug: "compress-image",
    isTool: true,
    indexable: true,
    locales: ["en", "ja"],
  },
  {
    key: "compress-image-to-500kb",
    slug: "compress-image-to-500kb",
    isTool: true,
    indexable: true,
    locales: ["en", "ja"],
  },
  {
    key: "compress-image-to-20kb",
    slug: "compress-image-to-20kb",
    isTool: true,
    indexable: true,
    locales: ["en"],
  },
  {
    key: "compress-image-to-50kb",
    slug: "compress-image-to-50kb",
    isTool: true,
    indexable: true,
    locales: ["en"],
  },
  {
    key: "compress-image-to-100kb",
    slug: "compress-image-to-100kb",
    isTool: true,
    indexable: true,
    locales: ["en"],
  },
  {
    key: "compress-image-to-200kb",
    slug: "compress-image-to-200kb",
    isTool: true,
    indexable: true,
    locales: ["en"],
  },
  { key: "remove-exif", slug: "remove-exif", isTool: true, indexable: true, locales: ["en", "ja"] },
  { key: "png-to-webp", slug: "png-to-webp", isTool: true, indexable: true, locales: ["en", "ja"] },
  {
    key: "compress-png",
    slug: "compress-png",
    isTool: true,
    indexable: true,
    locales: ["en", "ja"],
  },
  {
    key: "png-to-jpg",
    slug: "png-to-jpg",
    isTool: true,
    indexable: true,
    locales: ["en", "ja"],
  },
  {
    key: "webp-to-jpg",
    slug: "webp-to-jpg",
    isTool: true,
    indexable: true,
    locales: ["en", "ja"],
  },
  {
    key: "avif-to-jpg",
    slug: "avif-to-jpg",
    isTool: true,
    indexable: true,
    locales: ["en"],
  },
  {
    key: "signature-resizer",
    slug: "signature-resizer",
    isTool: true,
    indexable: true,
    locales: ["en"],
  },
  { key: "licenses", slug: "licenses", isTool: false, indexable: false, locales: ["en", "ja"] },
  { key: "privacy", slug: "privacy", isTool: false, indexable: false, locales: ["en", "ja"] },
  { key: "terms", slug: "terms", isTool: false, indexable: false, locales: ["en", "ja"] },
  { key: "contact", slug: "contact", isTool: false, indexable: false, locales: ["en", "ja"] },
];

/** ツールページ(トップ含む)のみ */
export const TOOL_PAGES = SITE_PAGES.filter((page) => page.isTool);

/** indexableなページのみ(サイト全体ゲートとのAND条件は呼び出し側の責務) */
export const INDEXABLE_PAGES = SITE_PAGES.filter((page) => page.indexable);

/** SITE_PAGES全体で、そのページが実在するlocale込みで数えたURLの総数(例: en/ja両方あるページは2として数える) */
export const TOTAL_PAGE_URL_COUNT = SITE_PAGES.reduce((sum, page) => sum + page.locales.length, 0);

/** indexableなページだけで、locale込みで数えたURLの総数(sitemap.xmlの期待件数) */
export const EXPECTED_PUBLICATION_URL_COUNT = INDEXABLE_PAGES.reduce(
  (sum, page) => sum + page.locales.length,
  0,
);

/** localeとslugから公開URLのpathnameを組み立てる("/"・"/ja/"・"/heic-to-jpg/"・"/ja/heic-to-jpg/"等) */
export function pathnameFor(locale, slug) {
  const prefix = locale === "ja" ? "/ja" : "";
  if (slug === "") {
    return `${prefix}/`;
  }
  return `${prefix}/${slug}/`;
}

/** localeとslugからdist/配下の相対パスを組み立てる(index.htmlファイル) */
export function distRelFor(locale, slug) {
  const prefix = locale === "ja" ? "ja/" : "";
  const seg = slug === "" ? "" : `${slug}/`;
  return `${prefix}${seg}index.html`;
}

/** originと組み合わせて絶対URLを組み立てる */
export function urlFor(origin, locale, slug) {
  return `${origin}${pathnameFor(locale, slug)}`;
}

/**
 * SITE_PAGESを{ key, locale, slug, url, distRel }の平坦な一覧へ展開する。
 * originを渡さない場合、urlはpathnameのみ(相対)になる。
 */
export function expandPages(pages, origin) {
  return pages.flatMap((page) =>
    page.locales.map((locale) => ({
      key: page.key,
      locale,
      slug: page.slug,
      url: origin ? urlFor(origin, locale, page.slug) : pathnameFor(locale, page.slug),
      distRel: distRelFor(locale, page.slug),
    })),
  );
}
