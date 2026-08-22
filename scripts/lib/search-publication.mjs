/**
 * PR "search publication files"(robots.txt・sitemap.xml)のための純粋関数群。
 * ファイルI/O(dist/の走査・書き込み)はscripts/generate-search-publication-files.mjsが行い、
 * ここではHTML文字列・URL文字列だけを受け取って判定・整形する副作用なしの関数だけを持つ
 * (テストしやすくするため、およびロジックを1箇所に集約するため)。
 */
import { EXPECTED_PUBLICATION_URL_COUNT, INDEXABLE_PAGES } from "./site-pages.mjs";

export const PRODUCTION_ORIGIN = "https://limifile.com";

/** PUBLIC_ALLOW_INDEXINGの生値が、release-mode(検索公開ファイル生成)を有効にする値かどうか。
 * site-indexing.tsのisGlobalIndexingEnabledと同じ基準(厳密に文字列"true"のみ)を用いる。 */
export function isReleaseModeEnabled(rawValue) {
  return rawValue === "true";
}

/** HTML文字列から<link rel="canonical" href="...">のhrefを1件だけ抽出する。無ければnull */
export function extractCanonicalHref(html) {
  const match = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/);
  return match ? match[1] : null;
}

/** BaseLayout.astroが出力する<meta name="robots" content="noindex, nofollow">の有無を判定する */
export function hasNoindexRobotsMeta(html) {
  return html.includes('content="noindex, nofollow"');
}

/** sitemap対象から明示的に除外するpathname prefix(indexable設計上出現しないはずだが、防御的に除外する) */
const EXCLUDED_PATH_PREFIXES = [
  "/licenses/",
  "/ja/licenses/",
  "/privacy/",
  "/ja/privacy/",
  "/terms/",
  "/ja/terms/",
  "/contact/",
  "/ja/contact/",
  "/en/",
];

/**
 * canonical URLがsitemap収録に適格かを検証する。
 * - origin(https://limifile.com)への絶対URLであること
 * - query・hashを含まないこと
 * - 末尾スラッシュ付きであること(トップは"/"自身)
 * - 除外pathprefix(licenses/privacy/terms/contact/en)に該当しないこと
 */
export function isEligiblePublicationUrl(url, origin = PRODUCTION_ORIGIN) {
  if (typeof url !== "string" || url.length === 0) return false;
  if (!url.startsWith(origin)) return false;
  const rest = url.slice(origin.length);
  if (!rest.startsWith("/")) return false;
  if (url.includes("?") || url.includes("#")) return false;
  if (!url.endsWith("/")) return false;
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => rest.startsWith(prefix))) return false;
  return true;
}

/**
 * ソート専用の並び順キー(トップ→ツール10件、en→jaの順)。収録可否の判定には使わない。
 * site-pages.mjsのSITE_PAGES(indexableなページのみ)から導出し、二重管理を避ける。
 */
const ORDER_SLUGS = INDEXABLE_PAGES.map((page) => page.slug);

function sortKeyFor(url, origin) {
  const rest = url.slice(origin.length); // "/" | "/ja/" | "/heic-to-jpg/" | "/ja/heic-to-jpg/" ...
  const isJa = rest === "/ja/" || rest.startsWith("/ja/");
  const slug = isJa
    ? rest.slice("/ja/".length).replace(/\/$/, "")
    : rest.replace(/^\//, "").replace(/\/$/, "");
  const slugIndex = ORDER_SLUGS.indexOf(slug);
  return [isJa ? 1 : 0, slugIndex === -1 ? ORDER_SLUGS.length : slugIndex, url];
}

function compareSortKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * built HTMLファイル群(distRelPath・html文字列の配列)から、sitemap収録対象のURL一覧を組み立てる。
 * canonicalが存在し、noindexが付いていない(=index可能な)ページのみを対象にし、
 * origin・形式の妥当性チェック・重複排除・安定ソートまで行う。
 */
export function collectPublicationUrls(htmlEntries, origin = PRODUCTION_ORIGIN) {
  const seen = new Set();
  for (const { html } of htmlEntries) {
    if (hasNoindexRobotsMeta(html)) continue;
    const canonical = extractCanonicalHref(html);
    if (canonical === null) continue;
    if (!isEligiblePublicationUrl(canonical, origin)) continue;
    seen.add(canonical);
  }
  return Array.from(seen).sort((a, b) =>
    compareSortKeys(sortKeyFor(a, origin), sortKeyFor(b, origin)),
  );
}

/** XML特殊文字をエスケープする(現状のURLには出現しないが、防御的に実装・テストする) */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * sitemap.xmlの本文を組み立てる。lastmod・changefreq・priority・xhtml:link hrefLangは
 * 意図的に含めない(実際の更新日時を正確に管理していないため架空のlastmodを生成しない。
 * hreflangはHTML head側に既にあるため情報源を重複させない)。
 */
export function buildSitemapXml(urls) {
  const urlEntries = urls
    .map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`)
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urlEntries}\n` +
    `</urlset>\n`
  );
}

/**
 * robots.txtの本文を組み立てる。Disallowは一切含めない(noindexはページ単位のmeta robotsが担う)。
 * Cloudflare側でcontent-signalsのrobots.txtが管理されている場合、実際の本番レスポンスは
 * このrepository成果物の前にCloudflare管理分がprependされる可能性がある(既知事項、PR本文に記載)。
 */
export function buildRobotsTxt(sitemapUrl) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
}

/**
 * PUBLIC_ALLOW_INDEXINGの生値と、実際に収集できたURL件数から、generatorが取るべき行動を決める
 * 副作用なしの判定関数(fs操作を一切行わないため、実際のbuildを走らせずにテストできる)。
 *
 * - release-modeでない場合: "skip"(生成しない。呼び出し側は既存のstale成果物を削除する)
 * - release-modeで件数が期待値と異なる場合: "fail"(生成せずbuildを失敗させる)
 * - release-modeで件数が一致する場合: "generate"
 */
export function decideSearchPublicationAction(
  rawValue,
  urlCount,
  expectedCount = EXPECTED_PUBLICATION_URL_COUNT,
) {
  if (!isReleaseModeEnabled(rawValue)) {
    return { action: "skip" };
  }
  if (urlCount !== expectedCount) {
    return {
      action: "fail",
      reason: `index可能なcanonical URLが${expectedCount}件ちょうどにならなかった(実際: ${urlCount}件)`,
    };
  }
  return { action: "generate" };
}
