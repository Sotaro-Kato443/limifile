/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Umamiの公開website UUID。未設定時はUmami scriptもイベント送信も無効 */
  readonly PUBLIC_UMAMI_WEBSITE_ID?: string;
  /** Umami tracker script URL。未設定時はUmami Cloudの公式URLを使用 */
  readonly PUBLIC_UMAMI_SCRIPT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
