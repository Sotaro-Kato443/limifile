import { en } from "./trust-content/en";
import { ja } from "./trust-content/ja";
import type { ImplementedLocaleKey } from "./get-dictionary";
import type { TrustContent, TrustPageContent, TrustPageKey } from "./trust-content-types";

const TRUST_CONTENT: Record<ImplementedLocaleKey, TrustContent> = { en, ja };

/** localeに対応するTrustContent(privacy/terms/contact全件)を取得する */
export function getTrustContent(locale: ImplementedLocaleKey): TrustContent {
  return TRUST_CONTENT[locale];
}

/** localeとTrustPageKeyに対応するTrustPageContent(1ページ分)を取得する */
export function getTrustPageContent(
  locale: ImplementedLocaleKey,
  key: TrustPageKey,
): TrustPageContent {
  return TRUST_CONTENT[locale][key];
}
