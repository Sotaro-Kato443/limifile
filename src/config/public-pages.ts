import {
  buildLocalizedPathname,
  buildPublicAbsoluteUrl,
  normalizePathname,
  toPublicPathname,
  type AlternateUrl,
} from "../i18n/urls";
import { ACTIVE_LOCALES, DEFAULT_LOCALE, type LocaleKey } from "../i18n/locales";

/**
 * サイト全体で実在する公開ページ(locale非依存)のkey。ツールページ15件(トップ含む)+licenses+
 * 信頼ページ3件(privacy/terms/contact)。このファイルが「pathnameを持つ公開ページ」の唯一の
 * 一元管理場所であり、src/config/tool-page-config.tsの`ToolPageKey`はこの型からlicenses・
 * privacy・terms・contactを除いたsubsetとして定義する(循環importを避けるため、依存の向きは
 * tool-page-config.ts → public-pages.tsの一方向のみ)。
 */
export type PublicPageKey =
  | "default"
  | "heic-to-jpg"
  | "compress-image"
  | "compress-image-to-500kb"
  | "compress-image-to-20kb"
  | "compress-image-to-50kb"
  | "compress-image-to-100kb"
  | "compress-image-to-200kb"
  | "remove-exif"
  | "png-to-webp"
  | "compress-png"
  | "png-to-jpg"
  | "webp-to-jpg"
  | "avif-to-jpg"
  | "signature-resizer"
  | "licenses"
  | "privacy"
  | "terms"
  | "contact";

/** 表示・生成順序を含む全19key(トップ→ツール14件→licenses→privacy→terms→contact) */
export const PUBLIC_PAGE_KEYS: readonly PublicPageKey[] = [
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
  "licenses",
  "privacy",
  "terms",
  "contact",
];

/**
 * 英語版のみを公開するページ。日本語版(/ja/compress-image-to-{20,50,100,200}kb/・
 * /ja/avif-to-jpg/・/ja/signature-resizer/)は意図的に作らない。
 *
 * この配列が「英語版のみに存在するページ」の唯一の情報源であり、getLocalesForPage・
 * src/config/tool-page-config.tsのEnOnlyToolPageKeyはここから導出する。hreflang生成・
 * LanguageSwitcher表示・sitemap収録の可否はすべてここを起点に判定されるため、キーを増減する
 * ときはsrc/pages/ja/配下のroute fileの有無と必ず一致させること。
 */
const EN_ONLY_PAGE_KEYS = [
  "compress-image-to-20kb",
  "compress-image-to-50kb",
  "compress-image-to-100kb",
  "compress-image-to-200kb",
  "avif-to-jpg",
  "signature-resizer",
] as const satisfies readonly PublicPageKey[];

export type EnOnlyPublicPageKey = (typeof EN_ONLY_PAGE_KEYS)[number];

/** pageKeyが英語版のみのページ(日本語版が存在しない)かどうかを判定する */
export function isEnOnlyPage(pageKey: PublicPageKey): boolean {
  return (EN_ONLY_PAGE_KEYS as readonly PublicPageKey[]).includes(pageKey);
}

/**
 * そのpageKeyについて実在するlocaleの一覧を返す(常に少なくとも1件、DEFAULT_LOCALEを含む)。
 * 「型を満たすためだけの偽の翻訳」を作らずに済むよう、hreflang生成・LanguageSwitcher表示・
 * sitemap収録の可否は、すべてこの関数を単一の情報源として判定する。
 */
export function getLocalesForPage(pageKey: PublicPageKey): readonly LocaleKey[] {
  if (isEnOnlyPage(pageKey)) {
    return [DEFAULT_LOCALE.key];
  }
  return ACTIVE_LOCALES.map((locale) => locale.key);
}

const PATHNAME_WITHOUT_LOCALE: Record<PublicPageKey, string> = {
  default: "/",
  "heic-to-jpg": "/heic-to-jpg",
  "compress-image": "/compress-image",
  "compress-image-to-500kb": "/compress-image-to-500kb",
  "compress-image-to-20kb": "/compress-image-to-20kb",
  "compress-image-to-50kb": "/compress-image-to-50kb",
  "compress-image-to-100kb": "/compress-image-to-100kb",
  "compress-image-to-200kb": "/compress-image-to-200kb",
  "remove-exif": "/remove-exif",
  "png-to-webp": "/png-to-webp",
  "compress-png": "/compress-png",
  "png-to-jpg": "/png-to-jpg",
  "webp-to-jpg": "/webp-to-jpg",
  "avif-to-jpg": "/avif-to-jpg",
  "signature-resizer": "/signature-resizer",
  licenses: "/licenses",
  privacy: "/privacy",
  terms: "/terms",
  contact: "/contact",
};

/** PublicPageKeyからlocale非依存のpathname(prefix無し、末尾スラッシュ無し)を取得する */
export function getPagePathnameWithoutLocale(pageKey: PublicPageKey): string {
  return PATHNAME_WITHOUT_LOCALE[pageKey];
}

/** localeとPublicPageKeyから、そのlocaleにおける公開URL用pathname(prefix+末尾スラッシュ込み)を生成する */
export function buildLocalizedPagePath(locale: LocaleKey, pageKey: PublicPageKey): string {
  return toPublicPathname(buildLocalizedPathname(locale, getPagePathnameWithoutLocale(pageKey)));
}

/** localeとPublicPageKeyから絶対URL(公開URL形式)を生成する */
export function buildLocalizedPageUrl(
  origin: string,
  locale: LocaleKey,
  pageKey: PublicPageKey,
): string {
  return buildPublicAbsoluteUrl(origin, buildLocalizedPagePath(locale, pageKey));
}

/**
 * そのページの実在する翻訳すべての絶対URLをhreflang用に生成する。対象localeは
 * getLocalesForPageが返すもの(通常はACTIVE_LOCALES全件、EnOnlyPublicPageKeyならDEFAULT_LOCALEのみ)
 * に限定する。reserved locale(es/pt-BR/de/fr)は含めない。404には使用しない(呼び出し側でpageKeyを持つ
 * 通常ページのみに限定する)。
 */
export function buildPageAlternateUrls(origin: string, pageKey: PublicPageKey): AlternateUrl[] {
  const availableLocales = new Set(getLocalesForPage(pageKey));
  return ACTIVE_LOCALES.filter((locale) => availableLocales.has(locale.key)).map((locale) => ({
    locale: locale.key,
    hreflang: locale.hreflang,
    href: buildLocalizedPageUrl(origin, locale.key, pageKey),
  }));
}

/** x-defaultとして示すURL(常に既定言語=英語版のそのページ) */
export function buildXDefaultUrl(origin: string, pageKey: PublicPageKey): string {
  return buildLocalizedPageUrl(origin, DEFAULT_LOCALE.key, pageKey);
}

/**
 * locale prefixを除いたpathnameから、対応するPublicPageKeyを厳密に解決する。
 * 一致する公開ページが無い場合はnullを返す(404等を暗黙にdefaultへfallbackさせないため。
 * 「不明なpathnameをdefaultへ黙ってfallbackする」設計は意図的に採用しない)。
 */
export function resolvePublicPageKeyStrict(pathnameWithoutLocale: string): PublicPageKey | null {
  const normalized = normalizePathname(pathnameWithoutLocale);
  const entry = (Object.entries(PATHNAME_WITHOUT_LOCALE) as [PublicPageKey, string][]).find(
    ([, pathname]) => pathname === normalized,
  );
  return entry ? entry[0] : null;
}
