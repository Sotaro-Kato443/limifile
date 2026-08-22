export interface UmamiPublicConfig {
  websiteId: string;
  scriptUrl: string;
}

const DEFAULT_UMAMI_SCRIPT_URL = "https://cloud.umami.is/script.js";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 未設定なら完全に無効、設定する場合は公開UUIDとHTTPS trackerだけを許可する。 */
export function resolveUmamiPublicConfig(
  rawWebsiteId: string | undefined,
  rawScriptUrl: string | undefined,
): UmamiPublicConfig | null {
  const websiteId = rawWebsiteId?.trim();
  if (!websiteId) return null;
  if (!UUID_PATTERN.test(websiteId)) {
    throw new Error("PUBLIC_UMAMI_WEBSITE_ID must be a valid UUID.");
  }

  const scriptUrl = rawScriptUrl?.trim() || DEFAULT_UMAMI_SCRIPT_URL;
  let parsedScriptUrl: URL;
  try {
    parsedScriptUrl = new URL(scriptUrl);
  } catch {
    throw new Error("PUBLIC_UMAMI_SCRIPT_URL must be a valid HTTPS URL.");
  }
  if (parsedScriptUrl.protocol !== "https:") {
    throw new Error("PUBLIC_UMAMI_SCRIPT_URL must use HTTPS.");
  }

  return { websiteId, scriptUrl: parsedScriptUrl.toString() };
}
