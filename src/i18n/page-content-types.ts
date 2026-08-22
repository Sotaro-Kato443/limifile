import { isEnOnlyPage } from "../config/public-pages";
import type { EnOnlyToolPageKey, ToolPageKey } from "../config/tool-page-config";

/**
 * 「このページについて」等の説明文中に現れる1セグメント。
 * ページ内リンク(pageLink)はlocaleに応じたhrefを呼び出し側(RichParagraph)で解決するため、
 * ここではリンク先のPublicPageKey(licenses以外はToolPageKeyのsubset)とanchorのみを持つ。
 * externalLink/assetLinkはlocaleに依存しないURL(source package・ライセンス全文等)を
 * そのまま保持する(localeで変わらないため翻訳・変換の対象にしない)。
 */
export type ContentSegment =
  | { type: "text"; text: string }
  | { type: "pageLink"; page: ToolPageKey | "licenses"; anchor?: string; label: string }
  | { type: "externalLink"; href: string; label: string };

/** よくある質問1件。静的にHTMLへ埋め込む(FaqSection.astro)。JSON-LDは意図的に生成しない */
export interface FaqItem {
  question: string;
  answer: string;
}

/** 関連ツールへの内部リンク1件 */
export interface RelatedLink {
  page: ToolPageKey;
  label: string;
}

/**
 * 仕様表の1行。ラベルと値のみで、リンクや装飾は持たせない
 * (リンクが必要な補足はtechnicalNoteの担当)。
 */
export interface SpecItem {
  label: string;
  value: string;
}

/**
 * ツールページ(トップを除く6ページ)共通のlocale依存コンテンツ。検索結果から直接訪問した
 * 利用者が「何ができるか・使い方・制約・プライバシー・よくある疑問・関連ツール」を理解できるよう、
 * PR A3で単一の自由記述notesから責務ごとのセクションへ分割した。
 */
export interface ToolPageAboutContent {
  /** h1直下の短い導入文(見出しなし)。段落1つ分 */
  intro: ContentSegment[];
  featuresHeading: string;
  /** 主な特徴・対応内容の箇条書き(3〜5項目目安) */
  features: string[];
  howToHeading: string;
  /** 使い方の手順(箇条書き、3〜5項目目安) */
  howToSteps: string[];
  limitationsHeading: string;
  /** 重要な制約の箇条書き。実装で確認した事実のみを記載し、省略しない */
  limitations: string[];
  /**
   * limitationsの後に続く補足段落(LGPL表示等、リンクを含む自由記述が必要な場合のみ使う)。
   * 該当内容が無いツールは空配列(全ツールが同じ型を満たすようにするため、オプショナルにはしない)。
   */
  technicalNote: ContentSegment[][];
  /**
   * ドロップゾーン直下に置く仕様表の見出し(例: "Specifications")。
   * specsが空配列のツールでは描画されないが、型を揃えるため常に必須にする。
   */
  specsHeading: string;
  /**
   * 検証可能な事実のみを並べた仕様表。「サーバーに送らない」等の主張を、
   * 情緒的な訴求(privacyNote)とは別に事実として提示するためのもの。
   * 実装で確認できない内容(性能の目安、品質の保証等)は書かない。
   * 未整備のツールは空配列(technicalNote・popularSizesLinksと同じ方針で、
   * オプショナルにはしない)。空配列ならセクション自体を描画しない。
   */
  specs: SpecItem[];
  privacyHeading: string;
  /** ブラウザ内処理・非アップロードの説明(段落1つ分) */
  privacyNote: string;
  faqHeading: string;
  /** 4〜6問を目安(検索語の反復ではなく、操作前後に実際に持つ疑問を記載する) */
  faq: FaqItem[];
  relatedHeading: string;
  /** 2〜4件、同一ページへのリンクは含めない */
  relatedLinks: RelatedLink[];
  /**
   * 固定容量ページ(20/50/100/200/500KB)同士、および/compress-imageからの「人気の容量」導線。
   * 該当しないページは空配列(全ツールが同じ型を満たすようにするため、オプショナルにはしない。
   * technicalNoteと同じ方針)。空配列ならセクション自体を描画しない。relatedLinksの2〜4件制約とは
   * 独立した別セクションのため、5件(20/50/100/200/500KB)になっても構わない。
   */
  popularSizesHeading: string;
  popularSizesLinks: RelatedLink[];
}

/** トップページ固有のlocale依存コンテンツ */
export interface HomePageContent {
  cardsAriaLabel: string;
  /** h1直下の短い導入文(見出しなし)。LimiFileの目的・ブラウザ内処理の説明 */
  intro: ContentSegment[];
  /**
   * ツールカード直下に置く固定容量ページ(20/50/100/200/500KB)への小さな導線。
   * 大きなカードを増やすと同種カードが並んで情報設計が崩れるため、リンク群として出す。
   *
   * 20/50/100/200KBはen専用ページ(EnOnlyToolPageKey)であり、PopularSizesLinksは
   * buildLocalizedPagePath(locale, page)でURLを組み立てる。そのためjaでは実在しない
   * パスを指してしまうので、jaは空配列にする(/ja/compress-image/と同じ方針)。
   * 空配列ならセクション自体を描画しない。
   */
  popularSizesHeading: string;
  popularSizesLinks: RelatedLink[];
  /** ツールを目的別にまとめ、トップページ上で選びやすくするナビゲーション */
  purposeHeading: string;
  purposeGroups: {
    title: string;
    links: RelatedLink[];
  }[];
  /** 目的別ナビゲーション直下から既存の画像解析欄へ移動する導線 */
  analyzePrompt: string;
  analyzeLinkLabel: string;
  limitationsHeading: string;
  /** 指定容量到達・見た目・メタデータ結果の非保証、元画像保存・出力確認の案内 */
  limitations: string[];
  analyzeHeading: string;
  analyzeParagraph: string;
  faqHeading: string;
  /** 3〜5問を目安 */
  faq: FaqItem[];
}

export type ToolPageAboutKey = Exclude<ToolPageKey, "default">;

/** ToolPageAboutKeyのうち、en/ja両方が実在するもの(日本語コンテンツが満たすべきkey集合) */
export type LocalizedToolPageAboutKey = Exclude<ToolPageAboutKey, EnOnlyToolPageKey>;

/**
 * ToolPageAboutKeyがLocalizedToolPageAboutKey(en/ja両方が実在する)かどうかを判定する
 * runtime type guard。public-pages.tsのisEnOnlyPageを単一の情報源として使う。
 * get-page-content.tsのgetToolPageAboutが、castによる型の嘘ではなく実際の検証として使う。
 */
export function isLocalizedToolPageAboutKey(
  key: ToolPageAboutKey,
): key is LocalizedToolPageAboutKey {
  return !isEnOnlyPage(key);
}

/** 英語(全ToolPageAboutKeyを実装する)向けの型 */
export interface PageContent {
  home: HomePageContent;
  tools: Record<ToolPageAboutKey, ToolPageAboutContent>;
}

/** 日本語等、英語専用ページ(EnOnlyToolPageKey)を持たないlocale向けの型 */
export interface LocalizedPageContent {
  home: HomePageContent;
  tools: Record<LocalizedToolPageAboutKey, ToolPageAboutContent>;
}
