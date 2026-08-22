import { ACTIVE_LOCALES, DEFAULT_LOCALE, getLocaleDefinition, type LocaleKey } from "./locales";

export interface ParsedLocalePath {
  locale: LocaleKey;
  pathname: string;
}

export interface AlternateUrl {
  locale: LocaleKey;
  hreflang: string;
  href: string;
}

/**
 * pathnameを正規化する。
 * - query("?")・hash("#")以降は取り除く(canonical等には含めないため)
 * - 先頭に"/"を保証する
 * - "/"以外は末尾の"/"を取り除く("/"自体はそのまま維持する)
 */
export function normalizePathname(pathname: string): string {
  const withoutQueryAndHash = pathname.split(/[?#]/, 1)[0] ?? "";
  const withLeadingSlash = withoutQueryAndHash.startsWith("/")
    ? withoutQueryAndHash
    : `/${withoutQueryAndHash}`;
  if (withLeadingSlash === "/") {
    return "/";
  }
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
  return withoutTrailingSlash === "" ? "/" : withoutTrailingSlash;
}

/** localeのURL prefixコードを取得する(既定言語は空文字)。未知のlocaleKeyは例外を投げる */
export function getLocalePrefix(localeKey: LocaleKey): string {
  return getLocaleDefinition(localeKey).urlCode;
}

/**
 * pathnameの先頭セグメントが、有効なロケール(ACTIVE_LOCALES)のURLコードと一致する場合のみ、
 * そのロケールのpathnameとして切り出す。一致しない場合は既定言語(prefix無し)のpathnameとして扱う。
 *
 * これは「不明なlocaleを英語へ黙ってfallbackする」こととは異なる。prefix無し = 既定言語という
 * URL設計そのものの解決であり、有効なlocaleのURLコードのみを対象に判定する。
 */
export function stripLocalePrefix(rawPathname: string): ParsedLocalePath {
  const normalized = normalizePathname(rawPathname);
  if (normalized === "/") {
    return { locale: DEFAULT_LOCALE.key, pathname: "/" };
  }

  const segments = normalized.slice(1).split("/");
  const [first, ...rest] = segments;
  const matched = ACTIVE_LOCALES.find(
    (locale) => locale.urlCode !== "" && locale.urlCode === first,
  );

  if (!matched) {
    return { locale: DEFAULT_LOCALE.key, pathname: normalized };
  }

  const remainder = rest.length > 0 ? `/${rest.join("/")}` : "/";
  return { locale: matched.key, pathname: normalizePathname(remainder) };
}

/** localeとlocale非依存pathnameから、そのlocale用のpathname(prefix込み)を生成する */
export function buildLocalizedPathname(
  localeKey: LocaleKey,
  pathnameWithoutLocale: string,
): string {
  const prefix = getLocalePrefix(localeKey);
  const normalized = normalizePathname(pathnameWithoutLocale);

  if (prefix === "") {
    return normalized;
  }

  const suffix = normalized === "/" ? "" : normalized;
  return normalizePathname(`/${prefix}${suffix}`);
}

/** originと(locale込みの)pathnameを結合し、絶対URLを生成する。locale解決は行わない */
export function buildAbsoluteUrl(origin: string, pathname: string): string {
  const trimmedOrigin = origin.replace(/\/+$/, "");
  return `${trimmedOrigin}${normalizePathname(pathname)}`;
}

/**
 * ルート照合用pathname(normalizePathname、末尾スラッシュ無し)を、公開URL用pathnameへ変換する。
 * "/"はそのまま、それ以外は末尾に"/"を1つ付与する(trailingSlash: "always"の最終到達URLと
 * 一致させるため)。asset URL・source package URLなど、locale prefix/末尾スラッシュを
 * 付与すべきでないURLにはこの関数を適用しない(呼び出し側がリテラル文字列のまま扱う)。
 */
export function toPublicPathname(pathname: string): string {
  const normalized = normalizePathname(pathname);
  return normalized === "/" ? "/" : `${normalized}/`;
}

/**
 * originと公開URL用pathname(toPublicPathname等で末尾スラッシュまで整形済みのもの)を結合する。
 * buildAbsoluteUrlと異なり、pathnameを再正規化(末尾スラッシュ除去)しない。
 */
export function buildPublicAbsoluteUrl(origin: string, publicPathname: string): string {
  const trimmedOrigin = origin.replace(/\/+$/, "");
  return `${trimmedOrigin}${publicPathname}`;
}

/** localeとlocale非依存pathnameから絶対URLを生成する */
export function buildLocalizedUrl(
  origin: string,
  localeKey: LocaleKey,
  pathnameWithoutLocale: string,
): string {
  return buildAbsoluteUrl(origin, buildLocalizedPathname(localeKey, pathnameWithoutLocale));
}

/**
 * canonical URLを生成する。現状はbuildLocalizedUrlと同一の計算だが、
 * 「そのlocaleのそのページの正規URL」という用途を型・関数名として明示するために分けている。
 */
export function buildCanonicalUrl(
  origin: string,
  localeKey: LocaleKey,
  pathnameWithoutLocale: string,
): string {
  return buildLocalizedUrl(origin, localeKey, pathnameWithoutLocale);
}

/**
 * 同一ページの言語別URL一覧を生成する。
 * 呼び出し側が「実在する翻訳ページのlocale一覧」だけを渡す想定で、存在しないlocaleを
 * 自動的に補完することはしない(hreflangには実在する翻訳ページだけを含めるため)。
 */
export function buildAlternateUrls(
  origin: string,
  pathnameWithoutLocale: string,
  localeKeys: readonly LocaleKey[],
): AlternateUrl[] {
  return localeKeys.map((localeKey) => {
    const definition = getLocaleDefinition(localeKey);
    return {
      locale: localeKey,
      hreflang: definition.hreflang,
      href: buildLocalizedUrl(origin, localeKey, pathnameWithoutLocale),
    };
  });
}
