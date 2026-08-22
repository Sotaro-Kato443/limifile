import { resolvePublicPageKeyStrict, type PublicPageKey } from "../config/public-pages";
import type { ToolPageKey } from "../config/tool-page-config";
import { stripLocalePrefix } from "../i18n/urls";

export type ToolErrorCode =
  | "animated_image"
  | "decode_failed"
  | "encode_failed"
  | "invalid_input"
  | "processing_failed"
  | "target_unreachable"
  | "timeout"
  | "too_large"
  | "unsafe_dimensions"
  | "unsupported_browser";

export type ToolAnalyticsEvent =
  | { name: "process_start" }
  | { name: "process_success" }
  | { name: "process_error"; errorCode: ToolErrorCode }
  | { name: "download" };

interface UmamiTracker {
  track(eventName: string, data?: Record<string, string>): void;
}

declare global {
  interface Window {
    umami?: UmamiTracker;
  }
}

const NON_TOOL_PAGE_KEYS = new Set<PublicPageKey>(["licenses", "privacy", "terms", "contact"]);

const NORMALIZED_ERROR_CODES: Readonly<Record<string, ToolErrorCode>> = {
  "animated-png": "animated_image",
  "decode-failed": "decode_failed",
  "encode-failed": "encode_failed",
  error: "processing_failed",
  "input-too-large": "too_large",
  "invalid-jpeg": "invalid_input",
  "invalid-png": "invalid_input",
  "invalid-request": "invalid_input",
  "invalid-target": "invalid_input",
  "target-unreachable": "target_unreachable",
  timeout: "timeout",
  "too-large": "too_large",
  "unsafe-dimensions": "unsafe_dimensions",
  "unsupported-animation": "animated_image",
  "unsupported-browser": "unsupported_browser",
  "unsupported-encoder": "unsupported_browser",
  "unsupported-jpeg-encoder": "unsupported_browser",
  "unsupported-png-encoder": "unsupported_browser",
  "unsupported-webp-encoder": "unsupported_browser",
};

function isToolPageKey(pageKey: PublicPageKey | null): pageKey is ToolPageKey {
  return pageKey !== null && !NON_TOOL_PAGE_KEYS.has(pageKey);
}

export function resolveCurrentToolId(pathname: string): ToolPageKey | null {
  const { pathname: pathnameWithoutLocale } = stripLocalePrefix(pathname);
  const pageKey = resolvePublicPageKeyStrict(pathnameWithoutLocale);
  return isToolPageKey(pageKey) ? pageKey : null;
}

/**
 * 各処理エンジン固有の理由を、プライバシーポリシーで明示できる固定カテゴリへ正規化する。
 * 未知の文字列は送信せず、必ず汎用カテゴリへ落とす。これによりWorkerの詳細メッセージや
 * ファイル由来の文字列が、将来誤って分析サービスへ渡ることを防ぐ。
 */
export function normalizeToolErrorCode(rawCode: unknown): ToolErrorCode {
  if (typeof rawCode !== "string") return "processing_failed";
  return NORMALIZED_ERROR_CODES[rawCode] ?? "processing_failed";
}

/**
 * Umamiへ送信できるイベントを4種類・最大2プロパティへ限定した唯一の入口。
 * 呼び出し側は任意のpayloadを渡せないため、画像・ファイル名・容量・寸法・メタデータ・
 * 自由記述のエラー内容を計測へ混入させない。
 */
export function trackToolEvent(event: ToolAnalyticsEvent): void {
  if (typeof window === "undefined" || typeof window.umami?.track !== "function") return;

  const toolId = resolveCurrentToolId(window.location.pathname);
  if (!toolId) return;

  const data: Record<string, string> = { tool_id: toolId };
  if (event.name === "process_error") {
    data.error_code = event.errorCode;
  }

  window.umami.track(event.name, data);
}
