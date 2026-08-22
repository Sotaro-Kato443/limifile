/**
 * サイト全体で扱うロケールの定義。
 *
 * 内部locale key・URL用コード・HTML lang(hreflang)・OGP localeは、それぞれ別の用途・別の表記ゆれを
 * 持ちうるため、意図的に別々のフィールドとして定義する(例: pt-BRはURLコードが"pt-br"、
 * HTML lang/hreflangは"pt-BR"であり、この2つを同一視しない)。
 */
export type LocaleKey = "en" | "ja" | "es" | "pt-BR" | "de" | "fr";

export interface LocaleDefinition {
  /** 内部locale key。コード内の識別子としてのみ使う */
  key: LocaleKey;
  /** URLパスのprefixコード。既定言語は空文字("")でprefix無しを表す */
  urlCode: string;
  /** <html lang>に使うBCP47コード */
  htmlLang: string;
  /** hreflang属性値。現状はhtmlLangと同じ値だが、用途が異なるため別フィールドとして持つ */
  hreflang: string;
  /** OGPのog:locale値(アンダースコア区切り) */
  ogLocale: string;
  /** 言語切替UI等で使う、その言語自身での表示名(自言語表記) */
  displayName: string;
  /** サイトの既定言語かどうか。trueはLOCALES内で1件のみ */
  isDefault: boolean;
  /** 現時点でAstroの有効routeとして生成する対象かどうか */
  isEnabled: boolean;
  /**
   * 定義だけを持ち、routeを生成しないreserved localeかどうか。
   *
   * 有効化の予定を表すものではない。これらの定義は、locale固有の表記ゆれ(例: pt-BRの
   * urlCode="pt-br" と htmlLang="pt-BR")を実例として型に固定し、「有効でないlocaleの
   * URL・hreflang・ディレクトリがビルド成果物へ漏れていないこと」を検証する負の回帰テストの
   * 対象として使うために存在する。
   */
  isReserved: boolean;
}

export const LOCALES: readonly LocaleDefinition[] = [
  {
    key: "en",
    urlCode: "",
    htmlLang: "en",
    hreflang: "en",
    ogLocale: "en_US",
    displayName: "English",
    isDefault: true,
    isEnabled: true,
    isReserved: false,
  },
  {
    key: "ja",
    urlCode: "ja",
    htmlLang: "ja",
    hreflang: "ja",
    ogLocale: "ja_JP",
    displayName: "日本語",
    isDefault: false,
    isEnabled: true,
    isReserved: false,
  },
  {
    key: "es",
    urlCode: "es",
    htmlLang: "es",
    hreflang: "es",
    ogLocale: "es_ES",
    displayName: "Español",
    isDefault: false,
    isEnabled: false,
    isReserved: true,
  },
  {
    key: "pt-BR",
    urlCode: "pt-br",
    htmlLang: "pt-BR",
    hreflang: "pt-BR",
    ogLocale: "pt_BR",
    displayName: "Português (Brasil)",
    isDefault: false,
    isEnabled: false,
    isReserved: true,
  },
  {
    key: "de",
    urlCode: "de",
    htmlLang: "de",
    hreflang: "de",
    ogLocale: "de_DE",
    displayName: "Deutsch",
    isDefault: false,
    isEnabled: false,
    isReserved: true,
  },
  {
    key: "fr",
    urlCode: "fr",
    htmlLang: "fr",
    hreflang: "fr",
    ogLocale: "fr_FR",
    displayName: "Français",
    isDefault: false,
    isEnabled: false,
    isReserved: true,
  },
];

/** 現時点でAstroの有効routeとして生成してよいロケールのみ(en・ja) */
export const ACTIVE_LOCALES: readonly LocaleDefinition[] = LOCALES.filter(
  (locale) => locale.isEnabled,
);

/** routeを生成しないreserved locale(es・pt-BR・de・fr)。負の回帰テスト用の定義であり、有効化の予定は含意しない */
export const RESERVED_LOCALES: readonly LocaleDefinition[] = LOCALES.filter(
  (locale) => locale.isReserved,
);

const defaultLocale = LOCALES.find((locale) => locale.isDefault);
if (!defaultLocale) {
  throw new Error("LOCALES must contain exactly one entry with isDefault: true");
}

/** サイトの既定言語(現時点では英語)。prefix無しURLに対応する */
export const DEFAULT_LOCALE: LocaleDefinition = defaultLocale;

/**
 * localeKeyから定義を取得する。
 * 未定義のkeyを渡した場合は例外を投げる(不明なlocaleを黙って既定言語へfallbackしない)。
 */
export function getLocaleDefinition(localeKey: LocaleKey): LocaleDefinition {
  const found = LOCALES.find((locale) => locale.key === localeKey);
  if (!found) {
    throw new Error(`Unknown locale key: "${localeKey}"`);
  }
  return found;
}

/** 文字列が現時点で有効なlocale keyかどうかを判定する(型ガード) */
export function isActiveLocaleKey(value: string): value is LocaleKey {
  return ACTIVE_LOCALES.some((locale) => locale.key === value);
}
