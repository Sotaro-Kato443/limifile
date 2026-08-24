#!/usr/bin/env node
/**
 * ビルド成果物(dist/)を対象に、PR A2-2(英語root + 日本語/ja/ルート移行)後のSEO基盤が
 * 想定通りであることを検証するスクリプト。
 *
 * 通常ページ30件(英語17・日本語13。固定容量20/50/100/200KBページ4件は英語のみ)について、
 * locale別<html lang>・自己参照canonical(末尾スラッシュ付き)・og:url/og:locale・
 * 実在するlocale分のhreflang・x-default(常に英語版)・noindex挙動・localized JSON-LDを検証する。
 * 404(英語root・日本語/ja/404)についてはcanonical/og:url/hreflang/x-defaultを一切出力しないこと、
 * クライアントJSを読み込まないことを検証する。/en/・reserved locale(es/pt-BR/de/fr)のURL、および
 * /ja/compress-image-to-{20,50,100,200}kb/(意図的に作らない日本語版)が生成されていないことも確認する。
 *
 * 使い方: node scripts/verify-i18n-seo-foundation.mjs
 * (事前に `npm run build` を実行しておくことを推奨。未実行の場合はこのスクリプトが実行する)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_PAGES, TOTAL_PAGE_URL_COUNT, expandPages } from "./lib/site-pages.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(rootDir, "dist");
const origin = "https://limifile.com";

let failures = 0;
function check(label, condition, detail = "") {
  const mark = condition ? "OK  " : "FAIL";
  console.log(`[${mark}] ${label}${detail ? " — " + detail : ""}`);
  if (!condition) failures += 1;
}

if (!existsSync(distDir)) {
  console.log("dist/ が無いためビルドします: npm run build");
  execSync("npm run build", { cwd: rootDir, stdio: "inherit" });
}

/** SoftwareApplication JSON-LDを出さないページ(licenses・信頼ページ) */
const NON_TOOL_PAGE_KEYS = ["licenses", "privacy", "terms", "contact"];

/** クライアントJSを一切読み込まない静的ページ(licenses・信頼ページ) */
const STATIC_ONLY_PAGE_KEYS = ["licenses", "privacy", "terms", "contact"];

const HTML_LANG = { en: "en", ja: "ja" };
const OG_LOCALE = { en: "en_US", ja: "ja_JP" };

/**
 * 通常ページ一覧(locale非依存key・locale・公開URL・distの相対パス・期待html lang・期待og:locale)。
 * scripts/lib/site-pages.mjsのSITE_PAGES(test/site-pages-manifest.test.tsでsrc/config側の
 * 実装とクロスチェック済み)を単一の情報源として使い、実在するlocaleの組み合わせだけを対象にする
 * (英語専用ページに/ja/を掛け合わせた、実在しないURLを検証対象に含めない)。
 */
const canonicalPages = expandPages(SITE_PAGES).map((entry) => ({
  ...entry,
  htmlLang: HTML_LANG[entry.locale],
  ogLocale: OG_LOCALE[entry.locale],
}));

check(
  `通常ページが${TOTAL_PAGE_URL_COUNT}件定義されている`,
  canonicalPages.length === TOTAL_PAGE_URL_COUNT,
  `実際: ${canonicalPages.length}`,
);

function readDistHtml(distRel) {
  const filePath = path.join(distDir, distRel);
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, "utf-8");
}

function extractAttr(html, tagPattern) {
  const match = html.match(tagPattern);
  return match ? match[1] : null;
}

for (const page of canonicalPages) {
  const html = readDistHtml(page.distRel);
  if (html === null) {
    check(`dist/${page.distRel} が存在する`, false);
    continue;
  }

  check(
    `${page.url}: <html lang="${page.htmlLang}">になっている`,
    new RegExp(`<html\\s+lang="${page.htmlLang}"`).test(html),
  );

  const canonicalMatches = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]*)"/g)];
  check(`${page.url}: canonicalが1つだけ存在する`, canonicalMatches.length === 1);

  const expectedCanonical = `${origin}${page.url}`;
  const actualCanonical = canonicalMatches[0]?.[1];
  check(
    `${page.url}: canonicalが自己参照・末尾スラッシュ付き(${expectedCanonical})になっている`,
    actualCanonical === expectedCanonical,
    `実際: ${actualCanonical}`,
  );

  const ogUrl = extractAttr(html, /<meta\s+property="og:url"\s+content="([^"]*)"/);
  check(`${page.url}: og:urlがcanonicalと一致する`, ogUrl === actualCanonical, `実際: ${ogUrl}`);

  const ogLocale = extractAttr(html, /<meta\s+property="og:locale"\s+content="([^"]*)"/);
  check(
    `${page.url}: og:localeが${page.ogLocale}`,
    ogLocale === page.ogLocale,
    `実際: ${ogLocale}`,
  );

  const hreflangMatches = [
    ...html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]*)"\s+href="([^"]*)"/g),
  ].filter((m) => m[1] !== "x-default");
  const pageLocales = SITE_PAGES.find((sitePage) => sitePage.key === page.key)?.locales ?? [];
  check(
    `${page.url}: hreflangが実在するlocale(${pageLocales.join("・")})の分だけ存在する`,
    hreflangMatches.length === pageLocales.length,
    `実際: ${hreflangMatches.length}`,
  );

  const hreflangEn = hreflangMatches.find((m) => m[1] === "en")?.[2];
  const hreflangJa = hreflangMatches.find((m) => m[1] === "ja")?.[2];
  const expectedEnUrl = page.key === "default" ? `${origin}/` : `${origin}/${page.key}/`;
  const expectedJaUrl = page.key === "default" ? `${origin}/ja/` : `${origin}/ja/${page.key}/`;
  check(
    `${page.url}: hreflang en が ${expectedEnUrl}`,
    hreflangEn === expectedEnUrl,
    `実際: ${hreflangEn}`,
  );
  if (pageLocales.includes("ja")) {
    check(
      `${page.url}: hreflang ja が ${expectedJaUrl}`,
      hreflangJa === expectedJaUrl,
      `実際: ${hreflangJa}`,
    );
  } else {
    check(`${page.url}: 英語専用ページなのでhreflang jaを出力していない`, hreflangJa === undefined);
  }

  const xDefault = extractAttr(
    html,
    /<link\s+rel="alternate"\s+hreflang="x-default"\s+href="([^"]*)"/,
  );
  check(
    `${page.url}: x-defaultが英語版(${expectedEnUrl})を指す`,
    xDefault === expectedEnUrl,
    `実際: ${xDefault}`,
  );

  // reserved locale(es/pt-BR/de/fr)のhreflangが出力されていないこと
  for (const reservedHreflang of ["es", "pt-BR", "de", "fr"]) {
    check(
      `${page.url}: reserved locale(${reservedHreflang})のhreflangを出力していない`,
      !hreflangMatches.some((m) => m[1] === reservedHreflang),
    );
  }
}

// noindex挙動が変わっていないことの確認(このスクリプトはPUBLIC_ALLOW_INDEXINGを設定せずビルドした
// dist/を検証するため、site-indexing.tsの安全側デフォルトによりすべてnoindexになるはず)
for (const page of canonicalPages) {
  const html = readDistHtml(page.distRel);
  if (html === null) continue;
  check(
    `${page.url}: noindex, nofollowが付与されている(PUBLIC_ALLOW_INDEXING未設定ビルド)`,
    html.includes('content="noindex, nofollow"'),
  );
}

// SoftwareApplication JSON-LDがツールページ(licenses・信頼ページ以外)で維持されていること
const toolPages = canonicalPages.filter((page) => !NON_TOOL_PAGE_KEYS.includes(page.key));
for (const page of toolPages) {
  const html = readDistHtml(page.distRel);
  if (html === null) continue;
  check(
    `${page.url}: SoftwareApplicationのJSON-LDが維持されている`,
    html.includes('"@type":"SoftwareApplication"') ||
      html.includes('"@type": "SoftwareApplication"'),
  );
}

// licenses・信頼ページ(en/ja): JSONLDは元々無く、クライアントJSも無い静的ページのまま
const staticOnlyDistRels = STATIC_ONLY_PAGE_KEYS.flatMap((key) => [
  `${key}/index.html`,
  `ja/${key}/index.html`,
]);
for (const distRel of staticOnlyDistRels) {
  const html = readDistHtml(distRel);
  if (html === null) {
    check(`dist/${distRel} が存在する`, false);
    continue;
  }
  check(`${distRel}: astro-islandが存在しない(静的ページのまま)`, !html.includes("astro-island"));
  check(`${distRel}: <script>タグが存在しない`, !/<script[^>]*>/.test(html));
  check(
    `${distRel}: SoftwareApplicationのJSON-LDを出力していない`,
    !html.includes('"@type":"SoftwareApplication"') &&
      !html.includes('"@type": "SoftwareApplication"'),
  );
}

// 404ページ(英語root・日本語/ja/404): canonical/og:url/hreflang/x-defaultを一切出さない方針
const notFoundPages = [
  { distRel: "404.html", htmlLang: "en" },
  { distRel: "ja/404.html", htmlLang: "ja" },
];
for (const page of notFoundPages) {
  const notFoundHtml = readDistHtml(page.distRel);
  if (notFoundHtml === null) {
    check(`dist/${page.distRel} が存在する`, false);
    continue;
  }
  check(
    `${page.distRel}: <html lang="${page.htmlLang}">になっている`,
    new RegExp(`<html\\s+lang="${page.htmlLang}"`).test(notFoundHtml),
  );
  check(
    `${page.distRel}: canonicalを出力していない(方針により意図的に省略)`,
    !notFoundHtml.includes('rel="canonical"'),
  );
  check(`${page.distRel}: og:urlを出力していない`, !notFoundHtml.includes('property="og:url"'));
  // <link rel="alternate" hreflang>(SEO用のhead alternate)を対象とする。LanguageSwitcherの
  // <a hreflang="...">(リンク先言語を示す通常のアンカー属性、W3C仕様上のhreflangとは別用途)は
  // 404ページでも意図的に使うため、bare "hreflang=" 文字列の有無ではなくこのタグ形状で判定する。
  check(
    `${page.distRel}: <link rel="alternate" hreflang>を出力していない`,
    !/<link\s+rel="alternate"\s+hreflang=/.test(notFoundHtml),
  );
  check(
    `${page.distRel}: noindex, nofollowが維持されている`,
    notFoundHtml.includes('content="noindex, nofollow"'),
  );
  check(
    `${page.distRel}: astro-islandが存在しない(クライアントJS無し)`,
    !notFoundHtml.includes("astro-island"),
  );
  check(`${page.distRel}: <script>タグが存在しない`, !/<script[^>]*>/.test(notFoundHtml));
}

// 英語ページの可視本文に主要な日本語UI文言が残っていないこと・日本語ページには残っていること
// (JSON/scriptタグ内の技術的な文字列や、テストfixtureのファイル名等は誤検知の対象にしないため、
// このチェックは実際にページ本文へ表示される見出し・文言のみを対象にする)
const JAPANESE_MARKERS = ["画像処理をもっとシンプルに", "オープンソースライセンス", "圧縮する"];
for (const page of canonicalPages.filter((p) => p.locale === "en")) {
  const html = readDistHtml(page.distRel);
  if (html === null) continue;
  for (const marker of JAPANESE_MARKERS) {
    check(`${page.url}: 日本語UI文言「${marker}」を含まない`, !html.includes(marker));
  }
}
for (const page of canonicalPages.filter((p) => p.locale === "ja")) {
  const html = readDistHtml(page.distRel);
  if (html === null) continue;
  if (page.key === "default") {
    check(
      `${page.url}: 日本語UI文言「画像処理をもっとシンプルに」を含む`,
      html.includes("画像処理をもっとシンプルに"),
    );
  }
}

// /en/・reserved locale(es/pt-BR/de/fr)配下のディレクトリが生成されていないこと
for (const dir of ["en", "es", "pt-br", "de", "fr"]) {
  check(`dist/${dir}/ が生成されていない`, !existsSync(path.join(distDir, dir)));
}

// 固定容量4ページ(20/50/100/200KB)は英語版のみ公開する方針のため、
// /ja/compress-image-to-{20,50,100,200}kb/ のdistファイルが生成されていないことを明示的に確認する
// (「期待ページが欠けてもテストが通る」弱い検証を避けるため、存在チェックだけでなく不在チェックも行う)。
for (const slug of [
  "compress-image-to-20kb",
  "compress-image-to-50kb",
  "compress-image-to-100kb",
  "compress-image-to-200kb",
]) {
  check(
    `dist/ja/${slug}/ が生成されていない(日本語版は意図的に作らない)`,
    !existsSync(path.join(distDir, "ja", slug)),
  );
}

// dist/配下のHTML総数が28件であることを確認する
// (通常30 = 9 key×en/ja + 4 key×en専用、+ 404×2。Search Console所有権確認用の静的asset
// (googlea6d7326804b56d45.html)はAstroページではないため、この件数カウントの対象から明示的に除外する。)
const SEARCH_CONSOLE_VERIFICATION_FILE = "googlea6d7326804b56d45.html";
function listHtmlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      results.push(...listHtmlFiles(entryPath));
    } else if (entry.endsWith(".html") && entry !== SEARCH_CONSOLE_VERIFICATION_FILE) {
      results.push(entryPath);
    }
  }
  return results;
}
const allHtmlFiles = listHtmlFiles(distDir);
const EXPECTED_TOTAL_HTML_COUNT = TOTAL_PAGE_URL_COUNT + 2; // 通常ページ + 404(en/ja)
check(
  `dist/配下のHTMLファイルが合計${EXPECTED_TOTAL_HTML_COUNT}件(通常${TOTAL_PAGE_URL_COUNT} + 404×2)`,
  allHtmlFiles.length === EXPECTED_TOTAL_HTML_COUNT,
  `実際: ${allHtmlFiles.length}件`,
);

console.log(`\n合計失敗数: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
