import { en } from "./page-content/en";
import { ja } from "./page-content/ja";
import type { ImplementedLocaleKey } from "./get-dictionary";
import {
  isLocalizedToolPageAboutKey,
  type LocalizedPageContent,
  type PageContent,
  type ToolPageAboutContent,
  type ToolPageAboutKey,
} from "./page-content-types";

const PAGE_CONTENT_EN: PageContent = en;
const PAGE_CONTENT_JA: LocalizedPageContent = ja;

/** localeに対応するPageContent(トップ・各ツールページの「このページについて」/FAQ)を取得する */
export function getPageContent(locale: ImplementedLocaleKey): PageContent | LocalizedPageContent {
  return locale === "en" ? PAGE_CONTENT_EN : PAGE_CONTENT_JA;
}

/**
 * localeとツールページkeyに対応するToolPageAboutContentを取得する(トップ以外のページ用)。
 * 英語専用ページ(EnOnlyToolPageKey)にはsrc/pages/ja/配下のroute file自体が存在しないため、
 * locale="ja"かつkeyが英語専用ページ、という組み合わせで呼ばれることは実際には起こらない想定。
 * ただし「起こらないはず」を型のcastだけで済ませて`undefined`を静かに返すことは避け、
 * isLocalizedToolPageAboutKeyのruntime type guardで明示的に検証し、万一この組み合わせで
 * 呼ばれた場合は説明的なErrorをthrowする(呼び出し側のバグとして即座に気づけるようにするため)。
 */
export function getToolPageAbout(
  locale: ImplementedLocaleKey,
  key: ToolPageAboutKey,
): ToolPageAboutContent {
  if (locale === "en") {
    return PAGE_CONTENT_EN.tools[key];
  }
  if (!isLocalizedToolPageAboutKey(key)) {
    throw new Error(
      `getToolPageAbout: page "${key}" has no Japanese content — it is an English-only page ` +
        `(no src/pages/ja/${key}.astro route exists for it). This locale="ja" + key="${key}" ` +
        "combination should never be reachable; check the caller.",
    );
  }
  return PAGE_CONTENT_JA.tools[key];
}
