import { en } from "./dictionaries/en";
import { ja } from "./dictionaries/ja";
import type { CommonDictionary } from "./schema";

/**
 * 実際に翻訳が存在するロケール。LocaleKey(locales.ts)にはes/pt-BR/de/fr等の
 * reserved localeも含まれるが、辞書が存在するのは現時点でen/jaのみのため、
 * UI側のlocale propはこのUnionだけを受け付ける(存在しないロケールを黙って
 * 英語へfallbackさせず、TypeScriptの型チェックで指定漏れ・誤指定を検出するため)。
 */
export type ImplementedLocaleKey = "en" | "ja";

const DICTIONARIES: Record<ImplementedLocaleKey, CommonDictionary> = { en, ja };

/** localeに対応するCommonDictionary(UiDictionaryを含む)を取得する */
export function getDictionary(locale: ImplementedLocaleKey): CommonDictionary {
  return DICTIONARIES[locale];
}
