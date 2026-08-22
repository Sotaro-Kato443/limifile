#!/usr/bin/env node
/**
 * `npm run build`の一部として実行される、検索公開ファイル(dist/robots.txt・dist/sitemap.xml・
 * dist/sitemap.txt)の生成スクリプト。このPRでは検索公開そのものは行わない — 生成対象を
 * 切り替えるのは環境変数PUBLIC_ALLOW_INDEXINGのみで、Cloudflare Production側の値は変更しない。
 *
 * PUBLIC_ALLOW_INDEXINGが厳密に文字列"true"でない場合(通常build。未設定・"false"・その他値):
 *   - dist/robots.txt・dist/sitemap.xml・dist/sitemap.txtが残っていれば削除する
 *     (古いrelease-mode成果物の混入防止)
 *   - 生成は行わない
 *
 * PUBLIC_ALLOW_INDEXINGが厳密に"true"の場合(release-mode build):
 *   - dist/配下の全HTMLを走査し、canonicalを持ち・noindexが付いていないページだけをsitemap対象にする
 *   - 対象がscripts/lib/site-pages.mjsのEXPECTED_PUBLICATION_URL_COUNT件(現在24件:
 *     en/ja両方存在する9 tool page key×2 + 英語専用固定容量4 page key + avif-to-jpg・signature-resizerの
 *     計6 page key×1)ちょうどでなければ、ファイルを生成せずbuildを失敗させる
 *   - dist/sitemap.xml・dist/sitemap.txt・dist/robots.txtを生成する
 *
 * sitemap.txtはGoogleが公式サポートする「1行1URL」のテキストサイトマップ形式。
 * sitemap.xmlのSearch Console取得問題を切り分けるための代替送信経路として同じURL集合から生成し、
 * XMLとURL一覧が乖離しないようにする。robots.txtのSitemap行は従来どおりsitemap.xmlのみを指す。
 *
 * 判定ロジック自体はscripts/lib/search-publication.mjsのdecideSearchPublicationAction(副作用なし・
 * テスト対象)に集約し、ここではファイルシステム操作(走査・削除・書き込み)だけを行う。
 *
 * 使い方: npm run buildの一部として自動実行される
 * (astro build && node scripts/fix-nested-404-output.mjs && node scripts/generate-search-publication-files.mjs)
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_ORIGIN,
  buildRobotsTxt,
  buildSitemapXml,
  collectPublicationUrls,
  decideSearchPublicationAction,
} from "./lib/search-publication.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(rootDir, "dist");
const robotsPath = path.join(distDir, "robots.txt");
const sitemapPath = path.join(distDir, "sitemap.xml");
const sitemapTextPath = path.join(distDir, "sitemap.txt");

function removeIfExists(filePath, label) {
  if (existsSync(filePath)) {
    rmSync(filePath);
    console.log(`[generate-search-publication-files] 既存の${label}を削除しました(通常build)`);
  }
}

function listHtmlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      results.push(...listHtmlFiles(entryPath));
    } else if (entry.endsWith(".html")) {
      results.push(entryPath);
    }
  }
  return results;
}

const rawValue = process.env.PUBLIC_ALLOW_INDEXING;

if (!existsSync(distDir)) {
  console.error(
    "[generate-search-publication-files] dist/ が見つかりません。先にastro buildを実行してください。",
  );
  process.exit(1);
}

const htmlEntries = listHtmlFiles(distDir).map((filePath) => ({
  distRelPath: path.relative(distDir, filePath),
  html: readFileSync(filePath, "utf-8"),
}));
const urls = collectPublicationUrls(htmlEntries, PRODUCTION_ORIGIN);

const decision = decideSearchPublicationAction(rawValue, urls.length);

if (decision.action === "skip") {
  console.log(
    `[generate-search-publication-files] PUBLIC_ALLOW_INDEXING=${JSON.stringify(rawValue ?? null)} ` +
      `のため通常buildとして扱い、robots.txt・sitemap.xml・sitemap.txtは生成しません。`,
  );
  removeIfExists(robotsPath, "dist/robots.txt");
  removeIfExists(sitemapPath, "dist/sitemap.xml");
  removeIfExists(sitemapTextPath, "dist/sitemap.txt");
  process.exit(0);
}

if (decision.action === "fail") {
  console.error(
    `[generate-search-publication-files] ${decision.reason} のため、` +
      `robots.txt・sitemap.xml・sitemap.txtを生成せずbuildを失敗させます。`,
  );
  for (const url of urls) {
    console.error(`  - ${url}`);
  }
  process.exit(1);
}

const sitemapUrl = `${PRODUCTION_ORIGIN}/sitemap.xml`;
writeFileSync(sitemapPath, buildSitemapXml(urls), "utf-8");
writeFileSync(sitemapTextPath, `${urls.join("\n")}\n`, "utf-8");
writeFileSync(robotsPath, buildRobotsTxt(sitemapUrl), "utf-8");

console.log(
  `[generate-search-publication-files] dist/sitemap.xml を生成しました(${urls.length} URL)。`,
);
console.log(
  `[generate-search-publication-files] dist/sitemap.txt を生成しました(${urls.length} URL)。`,
);
console.log("[generate-search-publication-files] dist/robots.txt を生成しました。");
