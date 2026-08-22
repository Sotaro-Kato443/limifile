#!/usr/bin/env node
/**
 * ツールページ群(トップ含む15 key。うち固定容量20/50/100/200KBの4 key・avif-to-jpg・signature-resizerの
 * 計6 keyは英語専用)の検索公開コンテンツ整備 + page-level indexable有効化を検証するスクリプト。
 *
 * 通常build(PUBLIC_ALLOW_INDEXING未設定)で、24 tool pages(9 key×en/ja + 6 key×en)の
 * title/description一意性・h1・canonical/hreflang(実在するlocale数ぶん)/x-default・
 * SoftwareApplication JSON-LD・FAQPage等の未追加・FAQ/関連リンク/人気の容量リンクの
 * 静的表示・言語混在なし・禁止表現なしを検証したうえで、依然として全ページnoindexであることを確認する。
 *
 * さらにrelease-mode build(PUBLIC_ALLOW_INDEXING=true)を一時的に生成し、これら24ページの
 * noindexが外れる一方、licenses/privacy/terms/contact(8件)と404(2件)はnoindexのままであることを
 * 確認する。release-modeにおけるrobots.txt/sitemap.xmlの詳細な内容検証(URL一覧・順序・XML構造・
 * robots directive等)は scripts/verify-search-publication.mjs へ集約したため、ここでは両ファイルが
 * 存在することのみを確認する。検証後は通常build(noindex)を再生成して終了する
 * (Preview/Productionへ渡すdist/を常に安全側の状態に戻すため)。
 *
 * 使い方: node scripts/verify-tool-seo-content.mjs
 * (このスクリプトは常にdist/を再生成する。既存のdist/があっても上書きする)
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_PUBLICATION_URL_COUNT, SITE_PAGES, expandPages } from "./lib/site-pages.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(rootDir, "dist");
const origin = "https://limifile.com";
const brandSource = readFileSync(path.join(rootDir, "src/config/brand.ts"), "utf-8");
const brandName = brandSource.match(/export const BRAND_NAME = "([^"]+)"/)?.[1];
if (!brandName) {
  throw new Error("src/config/brand.tsからBRAND_NAMEを取得できません");
}

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

function extractAttr(html, tagPattern) {
  const match = html.match(tagPattern);
  return match ? match[1] : null;
}

function runBuild(env = {}) {
  rmSync(distDir, { recursive: true, force: true });
  execSync("npm run build", { cwd: rootDir, stdio: "inherit", env: { ...process.env, ...env } });
}

// ページ一覧はscripts/lib/site-pages.mjsのSITE_PAGES(test/site-pages-manifest.test.tsで
// src/config側の実装とクロスチェック済み)を単一の情報源として使う。英語専用ページ
// (compress-image-to-{20,50,100,200}kb)には/ja/を掛け合わせない — 実在するlocaleの組み合わせだけを
// 対象にすることで、「期待ページが欠けてもテストが通る」弱い検証にしない。
const HTML_LANG = { en: "en", ja: "ja" };
function withHtmlLang(entries) {
  return entries.map((entry) => ({ ...entry, htmlLang: HTML_LANG[entry.locale] }));
}

const toolPages = withHtmlLang(expandPages(SITE_PAGES.filter((page) => page.isTool)));
const infoPages = withHtmlLang(expandPages(SITE_PAGES.filter((page) => !page.isTool)));

/**
 * popular sizes導線(20/50/100/200/500KB相互リンク)を持つページ(page-content/en.tsの実装と対応させる)。
 * compress-image・compress-image-to-500kbは英語版だけがこの導線を持つ(日本語版には
 * リンク先の固定容量20/50/100/200KBページが存在しないため、page-content/ja.ts側は
 * popularSizesLinks: []のまま)。残り4件(20/50/100/200KB)はそもそも英語版しか存在しない。
 */
const POPULAR_SIZES_PAGE_KEYS = [
  "compress-image",
  "compress-image-to-500kb",
  "compress-image-to-20kb",
  "compress-image-to-50kb",
  "compress-image-to-100kb",
  "compress-image-to-200kb",
];
function expectsPopularSizesSection(page) {
  return POPULAR_SIZES_PAGE_KEYS.includes(page.key) && page.locale === "en";
}

// ============================================================
// STEP 1: 通常build(PUBLIC_ALLOW_INDEXING未設定)
// ============================================================
console.log("=== 通常build(PUBLIC_ALLOW_INDEXING未設定)を検証 ===");
runBuild();

check(
  `${EXPECTED_PUBLICATION_URL_COUNT} tool pages(13 key、うち4件は英語専用×locale)が定義されている`,
  toolPages.length === EXPECTED_PUBLICATION_URL_COUNT,
  `実際: ${toolPages.length}`,
);

const seenTitles = new Set();
const seenDescriptions = new Set();

const JAPANESE_TOOL_MARKERS = [
  "このツールでできること",
  "重要な制約",
  "よくある質問",
  "関連ツール",
  "ツールの選び方",
];
const ENGLISH_TOOL_MARKERS = [
  "What this tool does",
  "Important limitations",
  "Frequently asked questions",
  "Related tools",
  "How to choose a tool",
];

const FORBIDDEN_EN = [
  "100% secure",
  "completely safe",
  "fastest in the world",
  "best in the world",
  "guaranteed to reach",
  "always removes all",
  "completely anonymous",
  // Static assets and privacy-preserving page analytics still use ordinary network requests.
  // Keep local-processing claims scoped to the user's image rather than all device traffic.
  "nothing leaves your device",
  // signature-resizer: verifying width/height/size/format is not the same as guaranteeing a
  // submission will be accepted by whatever it's submitted to (content, background, margins, etc.
  // are out of scope). Keep the copy honest about what LimiFile can and can't verify.
  // (Deliberately not a bare "will be accepted" substring — that would also match honest
  // disclaimers phrased as a question, e.g. "does this guarantee ... will be accepted?".)
  "guaranteed to be accepted",
  "guaranteed accepted",
];
const FORBIDDEN_JA = [
  "100%安全",
  "完全に安全",
  "必ず削除されます",
  "業界最速",
  "世界最高",
  "完全に匿名化",
];

for (const page of toolPages) {
  const html = readDistHtml(page.distRel);
  if (html === null) {
    check(`dist/${page.distRel} が存在する`, false);
    continue;
  }

  check(
    `${page.url}: <html lang="${page.htmlLang}">`,
    new RegExp(`<html\\s+lang="${page.htmlLang}"`).test(html),
  );

  const title = extractAttr(html, /<title>([^<]+)<\/title>/);
  check(`${page.url}: <title>が存在する`, Boolean(title));
  if (title) {
    check(`${page.url}: titleが他ページと重複しない(${title})`, !seenTitles.has(title));
    seenTitles.add(title);
    check(
      `${page.url}: titleの末尾が${brandName}ブランド(| ${brandName})`,
      title.endsWith(`| ${brandName}`),
    );
    check(
      `${page.url}: ${brandName}ブランドがtitle内に1回だけ出現する`,
      (title.match(new RegExp(brandName, "g")) ?? []).length === 1,
    );
  }

  const description = extractAttr(html, /<meta\s+name="description"\s+content="([^"]*)"/);
  check(`${page.url}: meta descriptionが存在する`, Boolean(description));
  if (description) {
    check(`${page.url}: descriptionが他ページと重複しない`, !seenDescriptions.has(description));
    seenDescriptions.add(description);
  }

  check(`${page.url}: h1が1つだけ存在する`, (html.match(/<h1[^>]*>/g) ?? []).length === 1);

  const canonicalMatches = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]*)"/g)];
  check(`${page.url}: canonicalが1つだけ存在する`, canonicalMatches.length === 1);
  const expectedCanonical = `${origin}${page.url}`;
  check(
    `${page.url}: canonicalが自己参照(${expectedCanonical})`,
    canonicalMatches[0]?.[1] === expectedCanonical,
  );

  const hreflangMatches = [
    ...html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]*)"\s+href="([^"]*)"/g),
  ].filter((m) => m[1] !== "x-default");
  const pageLocaleCount =
    SITE_PAGES.find((sitePage) => sitePage.key === page.key)?.locales.length ?? 0;
  check(
    `${page.url}: hreflangが実在するlocale数(${pageLocaleCount})件ぶん存在する`,
    hreflangMatches.length === pageLocaleCount,
    `実際: ${hreflangMatches.length}`,
  );
  const xDefault = extractAttr(
    html,
    /<link\s+rel="alternate"\s+hreflang="x-default"\s+href="([^"]*)"/,
  );
  const expectedEnUrl = page.key === "default" ? `${origin}/` : `${origin}/${page.key}/`;
  check(`${page.url}: x-defaultが英語版(${expectedEnUrl})`, xDefault === expectedEnUrl);
  if (pageLocaleCount === 1) {
    check(
      `${page.url}: 英語専用ページなのでhreflang="en"がcanonical(自己参照)と一致する`,
      hreflangMatches[0]?.[2] === expectedCanonical,
    );
  }

  check(
    `${page.url}: SoftwareApplicationのJSON-LDが存在する`,
    html.includes('"@type":"SoftwareApplication"') ||
      html.includes('"@type": "SoftwareApplication"'),
  );
  for (const bannedType of ["FAQPage", "QAPage", "HowTo", "Review", "AggregateRating"]) {
    check(
      `${page.url}: ${bannedType}のJSON-LDを追加していない`,
      !html.includes(`"@type":"${bannedType}"`) && !html.includes(`"@type": "${bannedType}"`),
    );
  }

  check(`${page.url}: noindex, nofollow(通常build)`, html.includes('content="noindex, nofollow"'));

  const faqItemCount = (html.match(/class="faq-item"/g) ?? []).length;
  if (page.key === "default") {
    check(
      `${page.url}: FAQが3〜5問存在する`,
      faqItemCount >= 3 && faqItemCount <= 5,
      `実際: ${faqItemCount}`,
    );
  } else {
    check(
      `${page.url}: FAQが4〜6問存在する`,
      faqItemCount >= 4 && faqItemCount <= 6,
      `実際: ${faqItemCount}`,
    );
    check(
      `${page.url}: 関連ツールセクションが存在する`,
      html.includes('class="tool-page-related"'),
    );
    check(
      `${page.url}: 関連ツールリンクが2〜4件存在する`,
      (() => {
        const relatedSection = html.split('class="tool-page-related"')[1] ?? "";
        const linkCount = (relatedSection.split("</ul>")[0]?.match(/<li>/g) ?? []).length;
        return linkCount >= 2 && linkCount <= 4;
      })(),
    );

    // tool-page-popular-sizesはtool-page-relatedと併用するclass(class="tool-page-related
    // tool-page-popular-sizes")のため、完全一致ではなくbareなclass名の出現で判定する。
    const hasPopularSizesSection = html.includes("tool-page-popular-sizes");
    if (expectsPopularSizesSection(page)) {
      check(`${page.url}: 「人気の容量」セクションが存在する`, hasPopularSizesSection);
      check(
        `${page.url}: 「人気の容量」リンクが4〜5件存在する(20/50/100/200/500KBの組み合わせ)`,
        (() => {
          const popularSection = html.split("tool-page-popular-sizes")[1] ?? "";
          const linkCount = (popularSection.split("</ul>")[0]?.match(/<li>/g) ?? []).length;
          return linkCount >= 4 && linkCount <= 5;
        })(),
      );
    } else {
      check(
        `${page.url}: 「人気の容量」セクションを持たない(対象外ページ)`,
        !hasPopularSizesSection,
      );
    }
  }

  if (page.locale === "en") {
    for (const marker of JAPANESE_TOOL_MARKERS) {
      check(`${page.url}: 日本語見出し「${marker}」を含まない`, !html.includes(marker));
    }
    for (const phrase of FORBIDDEN_EN) {
      check(
        `${page.url}: 禁止表現「${phrase}」を含まない`,
        !html.toLowerCase().includes(phrase.toLowerCase()),
      );
    }
  } else {
    for (const marker of ENGLISH_TOOL_MARKERS) {
      check(`${page.url}: 英語見出し「${marker}」を含まない`, !html.includes(marker));
    }
    for (const phrase of FORBIDDEN_JA) {
      check(`${page.url}: 禁止表現「${phrase}」を含まない`, !html.includes(phrase));
    }
  }
}

// ============================================================
// STEP 2: release-mode build(PUBLIC_ALLOW_INDEXING=true)
// ============================================================
console.log("\n=== release-mode build(PUBLIC_ALLOW_INDEXING=true)を検証 ===");
runBuild({ PUBLIC_ALLOW_INDEXING: "true" });

for (const page of toolPages) {
  const html = readDistHtml(page.distRel);
  if (html === null) {
    check(`dist/${page.distRel} が存在する(release-mode)`, false);
    continue;
  }
  check(
    `${page.url}: noindexが外れ、index可能になっている(release-mode)`,
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

for (const distRel of ["404.html", "ja/404.html"]) {
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

// robots.txt/sitemap.xmlの詳細な内容検証はverify:search-publicationが担う。ここでは
// release-modeで両ファイルが存在すること(生成自体が動作していること)だけを確認する。
check(
  "release-mode: robots.txtが生成されている(詳細はverify:search-publicationで検証)",
  existsSync(path.join(distDir, "robots.txt")),
);
check(
  "release-mode: sitemap.xmlが生成されている(詳細はverify:search-publicationで検証)",
  existsSync(path.join(distDir, "sitemap.xml")),
);

// ============================================================
// STEP 3: 検証後、通常build(noindex)を再生成して終了する
// ============================================================
console.log("\n=== 検証後、通常build(noindex)へ戻す ===");
runBuild();
check(
  "通常buildへ戻した後もトップページがnoindexである",
  readDistHtml("index.html")?.includes('content="noindex, nofollow"') ?? false,
);

console.log(`\n合計失敗数: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
