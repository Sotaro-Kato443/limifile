#!/usr/bin/env node
/**
 * PR "search publication files"(robots.txt・sitemap.xml)を検証するスクリプト。
 *
 * Phase A: 通常build(PUBLIC_ALLOW_INDEXINGを確実に除いた状態)
 *   - 通常ページ32件(en/ja計9ツール×2 + 英語専用固定容量4ページ・avif-to-jpg・signature-resizerの
 *     計6ページ×1、licenses/privacy/terms/contactの8件込み)がすべてnoindex,nofollow
 *   - 404×2がnoindex
 *   - dist/robots.txt・dist/sitemap.xmlが存在しない
 *
 * Phase B: release-mode build(PUBLIC_ALLOW_INDEXING=true)
 *   - indexableな15 tool page key(トップ含む、うち6件は英語専用) × locale = 24ページの
 *     noindexが外れている(scripts/lib/site-pages.mjsのSITE_PAGES/INDEXABLE_PAGES参照)
 *   - licenses/privacy/terms/contact(en/ja計8件)はnoindexのまま
 *   - 404×2はnoindexのまま
 *   - dist/robots.txt・dist/sitemap.xmlが存在し、内容が仕様通り
 *
 * Phase C: 通常buildへ復元
 *   - トップがnoindex
 *   - dist/robots.txt・dist/sitemap.xmlが存在しない
 *
 * 使い方: node scripts/verify-search-publication.mjs
 * (このスクリプトは常にdist/を再生成する。既存のdist/があっても上書きする)
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_ORIGIN } from "./lib/search-publication.mjs";
import {
  EXPECTED_PUBLICATION_URL_COUNT,
  INDEXABLE_PAGES,
  SITE_PAGES,
  expandPages,
} from "./lib/site-pages.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(rootDir, "dist");
const robotsPath = path.join(distDir, "robots.txt");
const sitemapPath = path.join(distDir, "sitemap.xml");

let failures = 0;
function check(label, condition, detail = "") {
  const mark = condition ? "OK  " : "FAIL";
  console.log(`[${mark}] ${label}${detail ? " — " + detail : ""}`);
  if (!condition) failures += 1;
}

function readDistHtml(distRel) {
  const filePath = path.join(distDir, distRel);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

function runBuild(env = {}) {
  rmSync(distDir, { recursive: true, force: true });
  // PUBLIC_ALLOW_INDEXINGを明示的に除いた環境でbuildする(Phase A・Cで「確実に除く」ため)。
  const restEnv = { ...process.env };
  delete restEnv.PUBLIC_ALLOW_INDEXING;
  execSync("npm run build", {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...restEnv, ...env },
  });
}

// ページ一覧はscripts/lib/site-pages.mjsのSITE_PAGES(test/site-pages-manifest.test.tsで
// src/config側の実装とクロスチェック済み)を単一の情報源として使う。ここでは
// 「英語専用ページにも/ja/を掛け合わせて存在しないURLを作る」ような、locale非依存の
// ハードコードされたcross productは行わない。
const toolPages = expandPages(SITE_PAGES.filter((page) => page.isTool)).map((p) => ({
  url: p.url,
  distRel: p.distRel,
}));
const infoPages = expandPages(SITE_PAGES.filter((page) => !page.isTool)).map((p) => ({
  url: p.url,
  distRel: p.distRel,
}));
const notFoundPages = ["404.html", "ja/404.html"];

// ============================================================
// Phase A: 通常build(PUBLIC_ALLOW_INDEXINGを確実に除く)
// ============================================================
console.log("=== Phase A: 通常build(PUBLIC_ALLOW_INDEXING除去)を検証 ===");
runBuild();

for (const page of [...toolPages, ...infoPages]) {
  const html = readDistHtml(page.distRel);
  if (html === null) {
    check(`dist/${page.distRel} が存在する`, false);
    continue;
  }
  check(`${page.url}: noindex, nofollow(通常build)`, html.includes('content="noindex, nofollow"'));
}
for (const distRel of notFoundPages) {
  const html = readDistHtml(distRel);
  if (html === null) {
    check(`dist/${distRel} が存在する`, false);
    continue;
  }
  check(
    `dist/${distRel}: noindex, nofollow(通常build)`,
    html.includes('content="noindex, nofollow"'),
  );
}

check("Phase A: dist/robots.txt が存在しない", !existsSync(robotsPath));
check("Phase A: dist/sitemap.xml が存在しない", !existsSync(sitemapPath));

// ============================================================
// Phase B: release-mode build(PUBLIC_ALLOW_INDEXING=true)
// ============================================================
console.log("\n=== Phase B: release-mode build(PUBLIC_ALLOW_INDEXING=true)を検証 ===");
runBuild({ PUBLIC_ALLOW_INDEXING: "true" });

for (const page of toolPages) {
  const html = readDistHtml(page.distRel);
  if (html === null) {
    check(`dist/${page.distRel} が存在する(release-mode)`, false);
    continue;
  }
  check(
    `${page.url}: noindexが外れている(release-mode)`,
    !html.includes('content="noindex, nofollow"'),
  );
}
for (const page of infoPages) {
  const html = readDistHtml(page.distRel);
  if (html === null) {
    check(`dist/${page.distRel} が存在する(release-mode)`, false);
    continue;
  }
  check(
    `${page.url}: noindexが維持されている(release-mode)`,
    html.includes('content="noindex, nofollow"'),
  );
}
for (const distRel of notFoundPages) {
  const html = readDistHtml(distRel);
  if (html === null) {
    check(`dist/${distRel} が存在する(release-mode)`, false);
    continue;
  }
  check(
    `dist/${distRel}: noindexが維持されている(release-mode)`,
    html.includes('content="noindex, nofollow"'),
  );
}

check("Phase B: dist/robots.txt が存在する", existsSync(robotsPath));
check("Phase B: dist/sitemap.xml が存在する", existsSync(sitemapPath));

if (existsSync(robotsPath)) {
  const robotsTxt = readFileSync(robotsPath, "utf-8");
  check(
    "robots.txt: Content-Typeに相当するplain textである(HTMLタグを含まない)",
    !/<[a-z]/i.test(robotsTxt),
  );
  check("robots.txt: 'Allow: /' を含む", /^Allow:\s*\/\s*$/m.test(robotsTxt));
  check(
    `robots.txt: 正しいSitemap directiveを含む(${PRODUCTION_ORIGIN}/sitemap.xml)`,
    robotsTxt.includes(`Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`),
  );
  check("robots.txt: 'Disallow: /' を含まない", !/^Disallow:\s*\/\s*$/m.test(robotsTxt));
  check("robots.txt: User-agent: * を含む", /^User-agent:\s*\*\s*$/m.test(robotsTxt));
}

if (existsSync(sitemapPath)) {
  const sitemapXml = readFileSync(sitemapPath, "utf-8");

  let parsedUrls = [];
  let parseError = null;
  try {
    check(
      "sitemap.xml: XML宣言(UTF-8)で始まる",
      sitemapXml.trimStart().startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
    );
    check(
      "sitemap.xml: urlset namespaceが正しい",
      sitemapXml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'),
    );
    // 依存追加を避けるため、<loc>要素を正規表現で抽出する(このリポジトリのbuild形式は安定している)。
    parsedUrls = [...sitemapXml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    // <url>...</url>ブロック数とloc数が一致すること(構造として壊れていないことの簡易確認)。
    const urlBlockCount = (sitemapXml.match(/<url>/g) ?? []).length;
    check(
      "sitemap.xml: <url>ブロック数と<loc>数が一致する(構造が壊れていない)",
      urlBlockCount === parsedUrls.length,
    );
  } catch (err) {
    parseError = err;
  }
  check("sitemap.xml: parseできる(例外なし)", parseError === null, parseError?.message ?? "");

  check(
    `sitemap.xml: URLが${EXPECTED_PUBLICATION_URL_COUNT}件ちょうど`,
    parsedUrls.length === EXPECTED_PUBLICATION_URL_COUNT,
    `実際: ${parsedUrls.length}`,
  );
  check("sitemap.xml: URLに重複がない", new Set(parsedUrls).size === parsedUrls.length);

  // 期待順序はcollectPublicationUrlsのsortKeyFor(isJa→slugIndexの順)と同じ規則で組み立てる:
  // 全localeの中でenが先、その中でSITE_PAGES(=ORDER_SLUGS)の定義順。次にja、同じくSITE_PAGES順
  // (jaを持たない英語専用ページはここで自然に除外される)。
  const expandedIndexable = expandPages(INDEXABLE_PAGES, PRODUCTION_ORIGIN);
  const expectedUrls = [
    ...expandedIndexable.filter((p) => p.locale === "en").map((p) => p.url),
    ...expandedIndexable.filter((p) => p.locale === "ja").map((p) => p.url),
  ];
  check(
    `sitemap.xml: ${EXPECTED_PUBLICATION_URL_COUNT} URLが期待するcanonical一覧と完全一致する(順序含む)`,
    JSON.stringify(parsedUrls) === JSON.stringify(expectedUrls),
    `実際: ${JSON.stringify(parsedUrls)}`,
  );

  check(
    "sitemap.xml: 新規4URL(20/50/100/200KB、英語のみ)を含む",
    ["20kb", "50kb", "100kb", "200kb"].every((slug) =>
      parsedUrls.includes(`${PRODUCTION_ORIGIN}/compress-image-to-${slug}/`),
    ),
  );
  check(
    "sitemap.xml: 存在しない日本語版(/ja/compress-image-to-{20,50,100,200}kb/)を含まない",
    ["20kb", "50kb", "100kb", "200kb"].every(
      (slug) => !parsedUrls.includes(`${PRODUCTION_ORIGIN}/ja/compress-image-to-${slug}/`),
    ),
  );

  for (const url of parsedUrls) {
    check(`sitemap.xml: ${url} はquery/hashを含まない`, !url.includes("?") && !url.includes("#"));
    check(`sitemap.xml: ${url} は末尾スラッシュ付き`, url.endsWith("/"));
    check(
      `sitemap.xml: ${url} はtrust/licenses/404/enを含まない`,
      !url.includes("/licenses/") &&
        !url.includes("/privacy/") &&
        !url.includes("/terms/") &&
        !url.includes("/contact/") &&
        !url.includes("/404") &&
        !url.includes("/en/"),
    );
  }

  check("sitemap.xml: lastmodを含まない", !sitemapXml.includes("<lastmod>"));
  check("sitemap.xml: changefreqを含まない", !sitemapXml.includes("<changefreq>"));
  check("sitemap.xml: priorityを含まない", !sitemapXml.includes("<priority>"));
  check("sitemap.xml: xhtml:link(hreflang)を含まない", !sitemapXml.includes("xhtml:link"));
}

// ============================================================
// Phase C: 通常buildへ復元
// ============================================================
console.log("\n=== Phase C: 通常build(PUBLIC_ALLOW_INDEXING除去)へ復元 ===");
runBuild();

check(
  "Phase C: トップページがnoindexへ戻っている",
  readDistHtml("index.html")?.includes('content="noindex, nofollow"') ?? false,
);
check("Phase C: dist/robots.txt が存在しない", !existsSync(robotsPath));
check("Phase C: dist/sitemap.xml が存在しない", !existsSync(sitemapPath));

console.log(`\n合計失敗数: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
