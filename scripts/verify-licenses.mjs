#!/usr/bin/env node
/**
 * ビルド成果物(dist/)を対象に、ページごとのクライアント配布物(Preact/Astro Islandランタイム)が
 * 想定通りであることを検証するスクリプト。ソース文字列だけでなく、実際に生成されたHTML・
 * chunk参照を確認する(licenses.astro/THIRD_PARTY_NOTICES.mdの「どのページに何が配布されるか」
 * という記述が実態とずれていないかを検知するため)。PR A2-2で英語root/日本語ja/route両方に
 * ページ数が倍増したため、両locale分を検証する。
 *
 * 使い方: node scripts/verify-licenses.mjs
 * (事前に `npm run build` を実行しておくことを推奨。未実行の場合はこのスクリプトが実行する)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(rootDir, "dist");

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

// client:load でPreactコンポーネントを読み込む14ページ(英語7 + 日本語7)
const preactIslandPages = [
  "index.html",
  "heic-to-jpg/index.html",
  "compress-image/index.html",
  "compress-image-to-500kb/index.html",
  "remove-exif/index.html",
  "png-to-webp/index.html",
  "compress-png/index.html",
  "ja/index.html",
  "ja/heic-to-jpg/index.html",
  "ja/compress-image/index.html",
  "ja/compress-image-to-500kb/index.html",
  "ja/remove-exif/index.html",
  "ja/png-to-webp/index.html",
  "ja/compress-png/index.html",
];

// クライアントJSを一切読み込まない静的ページ(英語404・日本語404・licenses・信頼ページ×2locale)
const staticOnlyPages = [
  "404.html",
  "ja/404.html",
  "licenses/index.html",
  "ja/licenses/index.html",
  "privacy/index.html",
  "ja/privacy/index.html",
  "terms/index.html",
  "ja/terms/index.html",
  "contact/index.html",
  "ja/contact/index.html",
];

for (const rel of preactIslandPages) {
  const filePath = path.join(distDir, rel);
  if (!existsSync(filePath)) {
    check(`dist/${rel} が存在する`, false);
    continue;
  }
  const html = readFileSync(filePath, "utf-8");
  check(`dist/${rel}: astro-islandが存在する`, html.includes("astro-island"));

  const rendererMatch = html.match(/renderer-url="([^"]*client\.[\w-]+\.js)"/);
  check(
    `dist/${rel}: astro-islandがclient.*.js(Astro Islandランタイム)をrenderer-urlに持つ`,
    !!rendererMatch,
  );

  if (rendererMatch) {
    const rendererRelPath = rendererMatch[1].replace(/^\/?/, "");
    const rendererPath = path.join(distDir, rendererRelPath);
    const rendererExists = existsSync(rendererPath);
    check(`dist/${rendererRelPath} が実在する`, rendererExists);
    if (rendererExists) {
      const rendererJs = readFileSync(rendererPath, "utf-8");
      // client.jsはpreact.module.*.jsを静的importする(preact本体のロード)
      check(
        `dist/${rendererRelPath}: preact.module.*.js(Preact本体)を静的importする`,
        /from"\.\/preact\.module\.[\w-]+\.js"/.test(rendererJs),
      );
    }
  }
}

// 英語・日本語で同じrenderer-url(同一hashed asset)を再利用していること(locale別に
// 画像処理コードを二重生成していないことの確認)
const enRendererMatch = readDistRendererUrl("heic-to-jpg/index.html");
const jaRendererMatch = readDistRendererUrl("ja/heic-to-jpg/index.html");
function readDistRendererUrl(rel) {
  const html = readFileSync(path.join(distDir, rel), "utf-8");
  return html.match(/renderer-url="([^"]*client\.[\w-]+\.js)"/)?.[1] ?? null;
}
check(
  "英語heic-to-jpgと日本語heic-to-jpgが同じclient.*.js(Astro Islandランタイム)を再利用している",
  !!enRendererMatch && enRendererMatch === jaRendererMatch,
  `en: ${enRendererMatch}, ja: ${jaRendererMatch}`,
);

for (const rel of staticOnlyPages) {
  const filePath = path.join(distDir, rel);
  if (!existsSync(filePath)) {
    check(`dist/${rel} が存在する`, false);
    continue;
  }
  const html = readFileSync(filePath, "utf-8");
  check(`dist/${rel}: astro-islandが存在しない(静的ページ)`, !html.includes("astro-island"));
  check(`dist/${rel}: <script>タグが存在しない`, !/<script[^>]*>/.test(html));
  check(
    `dist/${rel}: client.*.js/preact.module.*.jsを参照しない`,
    !/client\.[\w-]+\.js/.test(html) && !/preact\.module\.[\w-]+\.js/.test(html),
  );
}

// dist/配下の全HTMLを再帰的に列挙する(将来ページが増えても網羅的に検査するため)
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

/**
 * Preact Signalsを使ったpropsを持つコンポーネントをclient:loadした場合、Astroは
 * astro-island要素へ`data-preact-signals`属性(JSON化されたsignals参照情報)を付与し、
 * client.js側はこの属性の有無で signals.module.*.js を動的importするかどうかを判定する
 * (dist/_astro/client.*.jsの実装: `if(r.dataset.preactSignals){...import("./signals.module...")}`)。
 * したがって、signals.module.*.jsが dist/_astro/ に存在するかどうかではなく、
 * この`data-preact-signals`属性がビルド成果物のどのHTMLにも現れないことをもって、
 * 「現状Signalsは実際には配布・使用されていない」を検証する。
 */
const allHtmlFiles = listHtmlFiles(distDir);
check(`dist/配下のHTMLファイルを検出した`, allHtmlFiles.length > 0, `${allHtmlFiles.length}件`);

let pagesWithSignalsMarker = [];
for (const filePath of allHtmlFiles) {
  const html = readFileSync(filePath, "utf-8");
  if (html.includes("data-preact-signals")) {
    pagesWithSignalsMarker.push(path.relative(distDir, filePath));
  }
}
check(
  "現状、どのページのastro-islandにもdata-preact-signals属性(Signals使用propsのマーカー)が付与されていない",
  pagesWithSignalsMarker.length === 0,
  pagesWithSignalsMarker.length > 0 ? `検出: ${pagesWithSignalsMarker.join(", ")}` : "",
);

/**
 * `@lucide/astro`のアイコンはビルド時にinline SVGへ展開されるため、JavaScript配布の有無を
 * 基準にした上の検査では捕捉できない。ここではdist/のHTMLから実際に配布しているアイコン名を
 * 導出し、THIRD_PARTY_NOTICES.md・licensesページが列挙している内容と一致することを検証する
 * (期待値のハードコードではなく、実配布物との突き合わせ)。
 *
 * アイコンを1つ追加するとライセンス表示の対象範囲が変わりうる(Lucide独自=ISCと、Feather由来
 * =MITが混在するため)ので、このチェックが落ちたらまず「そのアイコンがFeather由来かどうか」を
 * node_modules/@lucide/astro/LICENSEの115件リストで確認し、表示側を更新すること。
 */
const DOCUMENTED_LUCIDE_ICONS = [
  "lucide-arrow-left-right",
  "lucide-arrow-right",
  "lucide-chart-no-axes-column-increasing",
  "lucide-chevron-down",
  "lucide-file-search",
  "lucide-trash-2",
];
// SiteNavを描画しないページ(BaseLayout上に最小ヘッダーのみ)。ここにアイコンは現れない
const PAGES_WITHOUT_LUCIDE_ICONS = [
  "404.html",
  "ja/404.html",
  "licenses/index.html",
  "ja/licenses/index.html",
];

// 実際に描画されたアイコンだけを数えるため、SVG要素のclass属性(`class="lucide lucide-<名前>"`)に
// 限定して抽出する。licensesページ本文にはLucideのリポジトリURL(lucide-icons/lucide)や
// ライセンスファイル名(isc-mit-lucide.txt)が文字列として現れるため、単純な`lucide-`検索では
// これらを誤ってアイコンとして数えてしまう。
const LUCIDE_ICON_CLASS_PATTERN = /class="lucide lucide-([a-z0-9-]+)/g;

const shippedLucideIcons = new Set();
const pagesWithLucideIcons = new Set();
for (const filePath of allHtmlFiles) {
  const html = readFileSync(filePath, "utf-8");
  const iconNames = [...html.matchAll(LUCIDE_ICON_CLASS_PATTERN)].map((match) => match[1]);
  if (iconNames.length === 0) continue;
  pagesWithLucideIcons.add(path.relative(distDir, filePath));
  for (const iconName of iconNames) shippedLucideIcons.add(`lucide-${iconName}`);
}

const shippedIconList = [...shippedLucideIcons].sort();
check(
  "dist/が実際に配布しているLucideアイコンが、ライセンス表示で列挙している6種類と完全に一致する",
  shippedIconList.length === DOCUMENTED_LUCIDE_ICONS.length &&
    shippedIconList.every((icon, index) => icon === DOCUMENTED_LUCIDE_ICONS[index]),
  `実配布: ${shippedIconList.join(", ") || "(なし)"}`,
);

const pagesMissingIcons = allHtmlFiles
  .map((filePath) => path.relative(distDir, filePath))
  // Search Console検証用の静的ファイルはAstroのページではないため対象外
  .filter((rel) => rel !== "googlea6d7326804b56d45.html")
  .filter((rel) => !pagesWithLucideIcons.has(rel))
  .sort();
check(
  "Lucideアイコンを含まないページが/404・/ja/404・/licenses・/ja/licensesの4件だけである",
  pagesMissingIcons.length === PAGES_WITHOUT_LUCIDE_ICONS.length &&
    pagesMissingIcons.every((rel, index) => rel === [...PAGES_WITHOUT_LUCIDE_ICONS].sort()[index]),
  `含まないページ: ${pagesMissingIcons.join(", ") || "(なし)"}`,
);

// Lucideのライセンス全文ファイルが、ISCとFeather MITの両方の表示を含んでいること
const lucideLicenseText = readFileSync(
  path.join(rootDir, "public/licenses/isc-mit-lucide.txt"),
  "utf-8",
);
check(
  "public/licenses/isc-mit-lucide.txtがISCとFeather由来アイコンのMITの両方の表示を含む",
  lucideLicenseText.includes("ISC License") &&
    lucideLicenseText.includes("Lucide Icons and Contributors") &&
    lucideLicenseText.includes("Cole Bemis") &&
    lucideLicenseText.includes("derived from the Feather project"),
);

// licensesコンテンツ(英語・日本語)/ THIRD_PARTY_NOTICES.md のソース文字列チェック
// (過去の「全ページ」誤記の再発防止、および両言語での事実parity確認)
const licensesEnSource = readFileSync(
  path.join(rootDir, "src/components/licenses/LicensesContentEn.astro"),
  "utf-8",
);
const licensesJaSource = readFileSync(
  path.join(rootDir, "src/components/licenses/LicensesContentJa.astro"),
  "utf-8",
);
const noticesSource = readFileSync(path.join(rootDir, "THIRD_PARTY_NOTICES.md"), "utf-8");

check(
  "LicensesContentJa.astroに「全ページでブラウザへ配布」という不正確な表現が残っていない",
  !licensesJaSource.includes("全ページでブラウザへ配布"),
);
check(
  "THIRD_PARTY_NOTICES.mdに「あり(全ページ)」という不正確な表現が残っていない",
  !noticesSource.includes("あり(全ページ)"),
);
check(
  "LicensesContentJa.astroがAstroの「静的サイト生成・コンパイラ部分」と「Astro Islandクライアントランタイム」を区別している",
  licensesJaSource.includes("Astro Islandクライアントランタイム") &&
    licensesJaSource.includes("静的サイト生成・コンパイラ部分"),
);
check(
  "LicensesContentEn.astroがAstroの'static site generation/compiler part'と'Astro Island client runtime'を区別している",
  licensesEnSource.includes("Astro Island client runtime") &&
    /static (site generation|HTML generation)/.test(licensesEnSource),
);
check(
  "THIRD_PARTY_NOTICES.mdがAstroの2つの側面を区別している",
  noticesSource.includes("Astro Islandクライアントランタイム") &&
    noticesSource.includes("静的HTML生成・コンパイル部分"),
);

// 両言語のdependency名・versionのparity(事実が一致していること)
const requiredFacts = [
  "@discourse/heic",
  "1.0.0",
  "libheif",
  "1.19.7",
  "libde265",
  "1.0.15",
  "@upng/upng-js",
  "2.2.2",
  "pako",
  "2.2.0",
  "@lucide/astro",
  "1.32.0",
  "isc-mit-lucide.txt",
  "Cole Bemis",
  "filefit-heic-decoder-1.0.0-source.tar.gz",
  "heic-heading",
  "png-heading",
  "ui-heading",
  "icons-heading",
  "build-heading",
];
for (const fact of requiredFacts) {
  check(`LicensesContentJa.astroが"${fact}"を含む`, licensesJaSource.includes(fact));
  check(`LicensesContentEn.astroが"${fact}"を含む`, licensesEnSource.includes(fact));
}

console.log(`\n合計失敗数: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
