import { isEnOnlyPage } from "../config/public-pages";
import type { LocalizedToolPageKey, ToolPageKey } from "../config/tool-page-config";
import { en } from "./tool-content/en";
import { ja } from "./tool-content/ja";
import type { ImplementedLocaleKey } from "./get-dictionary";
import type { ToolContent } from "./schema";

const TOOL_CONTENT_EN: Record<ToolPageKey, ToolContent> = en;
const TOOL_CONTENT_JA: Record<LocalizedToolPageKey, ToolContent> = ja;

/**
 * ToolPageKeyがLocalizedToolPageKey(en/ja両方が実在する)かどうかを判定するruntime type guard。
 * public-pages.tsのisEnOnlyPage(locale availabilityの単一の情報源)を直接使う。
 *
 * あえてsrc/config/tool-page-config.tsからこの種のguardをimportしない: tool-page-config.tsは
 * このファイルの`getToolContent`をvalue importしているため、逆方向にそちらのvalue exportを
 * importするとget-tool-content.ts <-> tool-page-config.ts間でruntimeの循環importが生じる。
 * ここではpublic-pages.ts(tool-page-config.tsを介さない)を直接参照することでそれを避ける。
 */
function isLocalizedToolPageKey(key: ToolPageKey): key is LocalizedToolPageKey {
  return !isEnOnlyPage(key);
}

/**
 * localeとToolPageKeyに対応するToolContent(見出し・説明・ナビラベル・カード文言等)を取得する。
 * 英語専用ページ(EnOnlyToolPageKey)にはsrc/pages/ja/配下のroute file自体が存在しないため、
 * locale="ja"かつkeyが英語専用ページ、という組み合わせで呼ばれることは実際には起こらない想定。
 * ただし「起こらないはず」を型のcastだけで済ませて`undefined`を静かに返すことは避け、
 * isLocalizedToolPageKeyのruntime type guardで明示的に検証し、万一この組み合わせで呼ばれた場合は
 * 説明的なErrorをthrowする(呼び出し側のバグとして即座に気づけるようにするため)。
 */
export function getToolContent(locale: ImplementedLocaleKey, key: ToolPageKey): ToolContent {
  if (locale === "en") {
    return TOOL_CONTENT_EN[key];
  }
  if (!isLocalizedToolPageKey(key)) {
    throw new Error(
      `getToolContent: page "${key}" has no Japanese content — it is an English-only page ` +
        `(no src/pages/ja/${key}.astro route exists for it). This locale="ja" + key="${key}" ` +
        "combination should never be reachable; check the caller.",
    );
  }
  return TOOL_CONTENT_JA[key];
}
