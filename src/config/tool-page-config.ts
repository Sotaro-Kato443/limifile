import { getToolContent } from "../i18n/get-tool-content";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";
import {
  buildLocalizedPagePath,
  getLocalesForPage,
  type EnOnlyPublicPageKey,
  type PublicPageKey,
} from "./public-pages";

/**
 * ツールページ(トップ含む)のkey。公開ページ全体(ツール15件+licenses+信頼ページ3件)を管理する
 * PublicPageKey(public-pages.ts)から、licenses・privacy・terms・contactを除いたsubsetとして
 * 定義する。これらはツールナビゲーション・ツールカードの対象外のため、この型に含めない。
 */
export type ToolPageKey = Exclude<PublicPageKey, "licenses" | "privacy" | "terms" | "contact">;

/** ToolPageKeyのうち、英語版のみが存在するもの(public-pages.tsのEnOnlyPublicPageKeyのsubset) */
export type EnOnlyToolPageKey = Extract<ToolPageKey, EnOnlyPublicPageKey>;

/** ToolPageKeyのうち、en/ja両方が実在するもの。src/i18n/tool-content・page-content配下の
 * 日本語コンテンツが満たすべきkey集合はこちらを使う(英語専用ページの「偽の日本語コンテンツ」を
 * 型で要求しないため)。
 *
 * このkeyがLocalizedToolPageKeyかどうかを判定するruntime type guardは、あえてこのファイルには
 * 置かない。src/i18n/get-tool-content.tsがこのファイルの`getToolContent`をvalue importしている
 * ため、ここで`isEnOnlyPage`をvalue importして判定関数を公開すると、get-tool-content.ts側から
 * それをvalue importした瞬間にget-tool-content.ts <-> tool-page-config.ts間でruntimeの循環
 * importが生じる。判定が必要な箇所(get-tool-content.ts・page-content-types.ts)は、
 * それぞれpublic-pages.tsのisEnOnlyPageを直接使ってローカルに同等のguardを定義する。 */
export type LocalizedToolPageKey = Exclude<ToolPageKey, EnOnlyToolPageKey>;

/**
 * ツールページのlocale非依存の定義。見出し・説明・ナビラベル等のlocale依存文言は
 * src/i18n/tool-content/{en,ja}.ts(getToolContent経由)へ分離した(PR A2-1)。
 */
export interface ToolDefinition {
  key: ToolPageKey;
  /**
   * 検索エンジンへのインデックスを許可してよいか(ページ個別設定)。トップ+ツール14ページ
   * (固定容量20/50/100/200KBの4ページ、png-to-jpg・webp-to-jpg・avif-to-jpg・signature-resizer含む)
   * とも機能・固有コンテンツ
   * (SEO title/meta description/導入文/特徴/使い方/制約/プライバシー/FAQ/関連リンク)が
   * 揃っているためtrueにしている。
   * ただし実際にindex可能かはsite-indexing.tsのサイト全体ゲート(PUBLIC_ALLOW_INDEXING)との
   * AND条件で決まる。このリポジトリのコードは`PUBLIC_ALLOW_INDEXING`自体を変更・管理しておらず
   * (Cloudflare Pages Dashboard側のProject環境変数)、Cloudflare Production側の現在の実際の値を
   * コードから断定することはできない。詳細・既知の記録はREADMEの「indexing」節を参照。
   */
  indexable: boolean;
  // 拡張ポイント: ツール固有の既定値(出力形式・目標容量・メタデータ削除の既定等)が必要に
  // なった時点で、この型へフィールドとして追加する
}

const TOOL_DEFINITIONS: Record<ToolPageKey, ToolDefinition> = {
  default: { key: "default", indexable: true },
  "heic-to-jpg": { key: "heic-to-jpg", indexable: true },
  "compress-image": { key: "compress-image", indexable: true },
  "compress-image-to-500kb": { key: "compress-image-to-500kb", indexable: true },
  "compress-image-to-20kb": { key: "compress-image-to-20kb", indexable: true },
  "compress-image-to-50kb": { key: "compress-image-to-50kb", indexable: true },
  "compress-image-to-100kb": { key: "compress-image-to-100kb", indexable: true },
  "compress-image-to-200kb": { key: "compress-image-to-200kb", indexable: true },
  "remove-exif": { key: "remove-exif", indexable: true },
  "png-to-webp": { key: "png-to-webp", indexable: true },
  "compress-png": { key: "compress-png", indexable: true },
  "png-to-jpg": { key: "png-to-jpg", indexable: true },
  "webp-to-jpg": { key: "webp-to-jpg", indexable: true },
  "avif-to-jpg": { key: "avif-to-jpg", indexable: true },
  "signature-resizer": { key: "signature-resizer", indexable: true },
};

/**
 * ナビゲーション(グローバルnav)に表示する順序(トップは別枠のブランドリンクと役割が近いため先頭)。
 * 固定容量4ページ(20/50/100/200KB)は意図的にここへ追加しない — グローバルナビが肥大化するのを
 * 避けるため。これらのページへは/compress-image/・/compress-image-to-500kb/の
 * 「Popular target sizes」導線(page-content側)からのみ到達できる。
 * png-to-jpg・webp-to-jpgも同じ理由でグローバルナビへは追加しない(ナビを大量に増やさない方針を
 * 維持し、トップのツールカード(TOOL_CARD_ORDER)と各ページのRelated toolsからの到達に留める)。
 */
const NAV_ORDER: ToolPageKey[] = [
  "default",
  "heic-to-jpg",
  "compress-image",
  "compress-image-to-500kb",
  "remove-exif",
  "png-to-webp",
  "compress-png",
];

/**
 * カード一覧では実際に選べるツールのみを並べる(トップページ自体へのカードは不要)。
 * 固定容量4ページ(20/50/100/200KB)はNAV_ORDERと同じ理由で含めない。
 * png-to-jpg・webp-to-jpg・avif-to-jpgは主要な形式変換ツールとして、ホームページからの
 * 発見可能性を優先してここに含める(固定容量ページとは異なる扱い)。
 */
const TOOL_CARD_ORDER: ToolPageKey[] = [
  "heic-to-jpg",
  "compress-image",
  "compress-image-to-500kb",
  "remove-exif",
  "png-to-webp",
  "compress-png",
  "png-to-jpg",
  "webp-to-jpg",
  "avif-to-jpg",
  "signature-resizer",
];

/** ToolPageKeyからlocale非依存の定義(indexable等)を取得する */
export function getToolDefinition(key: ToolPageKey): ToolDefinition {
  return TOOL_DEFINITIONS[key];
}

export interface NavItem {
  key: ToolPageKey;
  href: string;
  label: string;
  /** 現在表示中のページと一致するか。aria-current="page"の付与に使う */
  current: boolean;
}

/**
 * 共通ナビゲーション用に、現在ページのkeyに応じたaria-current付きのリンク一覧を組み立てる。
 * hrefはlocaleに応じたprefix・末尾スラッシュ込みの公開URL(buildLocalizedPagePath)。
 * currentKeyは呼び出し側(ToolPageLayout等)がpropsとして明示したkeyであり、
 * URLから暗黙に再解決することはしない。信頼ページ(privacy/terms/contact/licenses)等、
 * ツールページ一覧に該当項目が無いページから呼ぶ場合はcurrentKeyを省略でき、その場合は
 * 全項目current=falseになる(誤ってツールページへaria-currentを付けないため)。
 */
export function resolveNavItems(locale: ImplementedLocaleKey, currentKey?: ToolPageKey): NavItem[] {
  return NAV_ORDER.map((key) => ({
    key,
    href: buildLocalizedPagePath(locale, key),
    label: getToolContent(locale, key).navLabel,
    current: currentKey !== undefined && key === currentKey,
  }));
}

export interface ToolCard {
  key: ToolPageKey;
  href: string;
  title: string;
  description: string;
  formats: string;
}

/**
 * トップページのツールカード一覧(トップページ自身は含まない)。hrefはlocale別の公開URL。
 * TOOL_CARD_ORDERはlocale非依存の一覧だが、avif-to-jpg等の英語専用ページ(EnOnlyToolPageKey)を
 * 含み得るため、そのページが実在しないlocale(ja)ではgetToolContent呼び出し自体を避けて
 * カードから除外する(getToolContentはEnOnlyToolPageKey×locale="ja"の組み合わせで例外を投げる
 * 設計のため、ここでフィルタせずに呼ぶと必ずクラッシュする)。
 */
export function getToolCards(locale: ImplementedLocaleKey): ToolCard[] {
  return TOOL_CARD_ORDER.filter((key) => getLocalesForPage(key).includes(locale)).map((key) => {
    const content = getToolContent(locale, key);
    return {
      key,
      href: buildLocalizedPagePath(locale, key),
      title: content.cardTitle,
      description: content.cardDescription,
      formats: content.formats,
    };
  });
}
