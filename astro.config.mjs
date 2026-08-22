// @ts-check
import { defineConfig } from "astro/config";

import preact from "@astrojs/preact";

// https://astro.build/config
export default defineConfig({
  // SSR/Cloudflare Functions/DBは導入せず、静的HTML出力のみとする
  output: "static",
  // canonical/OGP等の絶対URL生成に使う本番origin。Cloudflare Pagesのpreview環境で
  // ビルドしてもcanonicalがpreview URLではなく常にこの本番originを指すようにするため、
  // 環境変数ではなくビルド時に固定するこの設定値を使う。
  site: "https://limifile.com",
  integrations: [preact()],
  // PR A2-2: 英語をprefix無しの既定言語、日本語を/ja/配下とする。fallback・
  // redirectToDefaultLocaleは設定せず、自動言語リダイレクトを一切行わない
  // (ユーザーは常にLanguageSwitcherから明示的に移動する)。reserved locale
  // (es/pt-BR/de/fr)はsrc/i18n/locales.tsのRESERVED_LOCALESに留め、ここには含めない。
  i18n: {
    defaultLocale: "en",
    locales: ["en", "ja"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  // 最終到達URLを末尾スラッシュ付きに統一する(canonical/hreflangが301前ではなく
  // Cloudflare上で直接200になるURLを指すようにするため)。
  trailingSlash: "always",
});
