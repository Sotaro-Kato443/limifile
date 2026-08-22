import type { ContentSegment } from "./page-content-types";

/** 公開問い合わせ先。privacy/terms/contactの全ページ・全localeで同一の値を使う */
export const CONTACT_EMAIL = "bunmeiproducts@gmail.com";
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

/** 信頼ページ(privacy/terms/contact)1件分の見出しセクション */
export interface TrustSection {
  heading: string;
  /** 段落単位の配列。各段落はContentSegmentの配列(page-content-types.tsのものを再利用) */
  paragraphs: ContentSegment[][];
  /** 箇条書き(禁止事項・チェックリスト等)。無ければ省略可 */
  listItems?: string[];
}

/** privacy/terms/contact共通の1ページ分のlocale依存コンテンツ */
export interface TrustPageContent {
  /** <title>用の短い見出し(例: "Privacy Policy") */
  title: string;
  /** meta descriptionに使う説明文 */
  description: string;
  /** ページ本文のh1 */
  heading: string;
  /** 「制定日・最終更新日」表示用の完成済み文字列(例: "Effective date: August 4, 2026") */
  effectiveDateLabel: string;
  sections: TrustSection[];
}

export interface TrustContent {
  privacy: TrustPageContent;
  terms: TrustPageContent;
  contact: TrustPageContent;
}

export type TrustPageKey = keyof TrustContent;
