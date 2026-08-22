/**
 * サイト全体のインデックス許可可否を制御する。
 * 静的サイトのためビルド時の環境変数(PUBLIC_ALLOW_INDEXING)でのみ切り替わり、
 * 実行時(閲覧時)に動的に変わることはない。
 *
 * 判断ロジック:
 * - PUBLIC_ALLOW_INDEXINGが厳密に文字列"true"の場合のみ、ページ個別設定を参照する
 * - 未設定・"false"・その他の値はすべて全体noindex(安全側)
 * - ページ個別のindexableがfalseなら、全体がtrueでもnoindexのまま
 */

/** 環境変数の生値から、全体としてインデックスを許可するかを判定する */
export function isGlobalIndexingEnabled(rawValue: string | boolean | undefined): boolean {
  return rawValue === "true";
}

/** 全体設定とページ個別設定を組み合わせ、最終的なindex可否を決定する */
export function resolveIsIndexable(
  globalIndexingEnabled: boolean,
  pageIndexable: boolean,
): boolean {
  return globalIndexingEnabled && pageIndexable;
}
