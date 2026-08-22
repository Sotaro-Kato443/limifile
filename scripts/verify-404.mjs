#!/usr/bin/env node
/**
 * ビルド成果物(dist/)に対して、英語root 404・日本語/ja/404の両方が正しく機能することを
 * 検証するスクリプト。AstroのHTTP status(実際にサーバーが返すレスポンスコード)はVitestの
 * jsdom環境では直接検証できないため、`astro build`後に`astro preview`をローカル起動し、
 * 実際のHTTPリクエストで確認する。
 *
 * 使い方: node scripts/verify-404.mjs
 * (事前に `npm run build` を実行しておくことを推奨。未実行の場合はこのスクリプトが実行する)
 */
import { existsSync, readFileSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
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

// 1. dist/ が無ければビルドする
if (!existsSync(distDir)) {
  console.log("dist/ が無いためビルドします: npm run build");
  execSync("npm run build", { cwd: rootDir, stdio: "inherit" });
}

// 2. dist/404.html(英語)・dist/ja/404.html(日本語)の存在確認
const path404En = path.join(distDir, "404.html");
const path404Ja = path.join(distDir, "ja", "404.html");
check("dist/404.html(英語root)が生成されている", existsSync(path404En));
check("dist/ja/404.html(日本語)が生成されている", existsSync(path404Ja));

if (existsSync(path404En)) {
  const html = readFileSync(path404En, "utf-8");
  check('英語404: <html lang="en">', /<html\s+lang="en"/.test(html));
  check("英語404に noindex, nofollow が含まれる", html.includes('content="noindex, nofollow"'));
  check("英語404に h1 が1つだけある", (html.match(/<h1[^>]*>/g) ?? []).length === 1);
  check("英語404にトップページへのリンクがある", /<a[^>]*href="\/"[^>]*>/.test(html));
  check("英語404に日本語トップへのリンクがある", /<a[^>]*href="\/ja\/"[^>]*>/.test(html));
  check(
    "英語404は画像処理コンポーネント(astro-island/Workbench)を読み込まない",
    !html.includes("astro-island") && !html.includes("Workbench"),
  );
}

if (existsSync(path404Ja)) {
  const html = readFileSync(path404Ja, "utf-8");
  check('日本語404: <html lang="ja">', /<html\s+lang="ja"/.test(html));
  check("日本語404に noindex, nofollow が含まれる", html.includes('content="noindex, nofollow"'));
  check("日本語404に h1 が1つだけある", (html.match(/<h1[^>]*>/g) ?? []).length === 1);
  check(
    "日本語404本文が日本語(「ページが見つかりません」を含む)",
    html.includes("ページが見つかりません"),
  );
  check("日本語404に日本語トップへのリンクがある", /<a[^>]*href="\/ja\/"[^>]*>/.test(html));
  check("日本語404に英語トップへのリンクがある", /<a[^>]*href="\/"[^>]*>/.test(html));
  check(
    "日本語404は画像処理コンポーネント(astro-island/Workbench)を読み込まない",
    !html.includes("astro-island") && !html.includes("Workbench"),
  );
}

// 3. 既存22通常ページ分のHTMLが引き続き生成されていることを確認
const expectedPageDirs = [
  "index.html",
  "heic-to-jpg/index.html",
  "compress-image/index.html",
  "compress-image-to-500kb/index.html",
  "remove-exif/index.html",
  "png-to-webp/index.html",
  "compress-png/index.html",
  "licenses/index.html",
  "privacy/index.html",
  "terms/index.html",
  "contact/index.html",
  "ja/index.html",
  "ja/heic-to-jpg/index.html",
  "ja/compress-image/index.html",
  "ja/compress-image-to-500kb/index.html",
  "ja/remove-exif/index.html",
  "ja/png-to-webp/index.html",
  "ja/compress-png/index.html",
  "ja/licenses/index.html",
  "ja/privacy/index.html",
  "ja/terms/index.html",
  "ja/contact/index.html",
];
for (const rel of expectedPageDirs) {
  check(`dist/${rel} が存在する`, existsSync(path.join(distDir, rel)));
}

// 4. SPAフォールバック用の /* -> /index.html 200 のような _redirects ルールが無いこと
const redirectsPath = path.join(distDir, "_redirects");
if (existsSync(redirectsPath)) {
  const redirects = readFileSync(redirectsPath, "utf-8");
  check(
    "dist/_redirects に全経路catch-allのSPA fallback(/* /index.html 200)が無い",
    !/\/\*\s+\/index\.html\s+200/.test(redirects),
  );
  check(
    "dist/_redirects に接頭辞なしURLから/ja/への自動言語リダイレクトが無い(現URLは英語として再利用するため)",
    !/\/ja\/?/.test(redirects),
  );
} else {
  check("dist/_redirects は存在しない(意図した状態: 404.htmlの標準検出に委ねる)", true);
}

// 5. astro preview を起動し、実際のHTTPステータスを確認する
//    `npx astro ...`経由だとnpxのラッパープロセスが挟まりSIGTERMが実サーバーまで
//    確実に届かない場合があるため、node_modules/.bin/astroのスクリプトをnodeで直接起動する
//    (CI上でpreviewサーバーが確実に終了することを保証するため)。
const port = 4399;
console.log(`\nastro preview --port ${port} を起動して実HTTPステータスを確認します...`);
const astroBin = path.join(rootDir, "node_modules", "astro", "bin", "astro.mjs");
const server = spawn(process.execPath, [astroBin, "preview", "--port", String(port)], {
  cwd: rootDir,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverExited = false;
server.once("exit", () => {
  serverExited = true;
});

/** 同期的な最終手段。process終了イベント内では非同期処理ができないためSIGTERM送信のみ行う */
function killServerSync() {
  if (!serverExited && !server.killed) {
    server.kill("SIGTERM");
  }
}

/**
 * 通常の終了経路(成功時・例外時)から呼ぶ。SIGTERMを送った後、短時間で終了しなければ
 * SIGKILLへエスカレーションしてからprocess.exitする(CI上にpreviewサーバーを残留させないため)。
 */
async function stopServerAndExit(code) {
  if (serverExited || server.killed) {
    process.exit(code);
  }
  server.kill("SIGTERM");
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited) {
    server.kill("SIGKILL");
  }
  process.exit(code);
}

// 途中で例外/シグナルが発生してもpreviewサーバーが残留しないための安全網
process.on("exit", killServerSync);
process.on("SIGINT", () => {
  killServerSync();
  process.exit(1);
});
process.on("SIGTERM", () => {
  killServerSync();
  process.exit(1);
});

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status) return true;
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const ready = await waitForServer(`http://localhost:${port}/`);
  check("astro preview サーバーが起動した", ready);

  if (ready) {
    const existingPages = [
      "/",
      "/heic-to-jpg/",
      "/compress-image/",
      "/compress-image-to-500kb/",
      "/remove-exif/",
      "/png-to-webp/",
      "/compress-png/",
      "/licenses/",
      "/privacy/",
      "/terms/",
      "/contact/",
      "/ja/",
      "/ja/heic-to-jpg/",
      "/ja/compress-image/",
      "/ja/compress-image-to-500kb/",
      "/ja/remove-exif/",
      "/ja/png-to-webp/",
      "/ja/compress-png/",
      "/ja/licenses/",
      "/ja/privacy/",
      "/ja/terms/",
      "/ja/contact/",
    ];
    for (const p of existingPages) {
      const res = await fetch(`http://localhost:${port}${p}`);
      check(`GET ${p} -> 200`, res.status === 200, `実際: ${res.status}`);
    }

    // 注記: `astro preview`はtrailingSlash: "always"設定下では、末尾スラッシュ無しURLに対して
    // 独自の汎用404("trailingSlash is set to \"always\"")を返すのみで、Cloudflare Pagesが実際に
    // 行う「末尾スラッシュ付きURLへの301 redirect」を再現しない。また、パスごとに最も近い
    // 404.htmlを探すCloudflareの挙動(nearest-404)も再現せず、未知パスには常に単一の
    // dist/404.html(英語)だけを返す。したがってこの2点は、ローカルのHTTPアサーションではなく
    // Cloudflare PR Preview(手順24)の実URLで確認する。ここでは、astro previewでも安定して
    // 確認できる「未知パスは常に404ステータスを返す」ことと、「静的ファイルとしてのdist/404.html・
    // dist/ja/404.htmlの内容」(このスクリプト冒頭で検証済み)のみをローカルの根拠とする。
    console.log(
      "[NOTE] 末尾スラッシュ無しURLのredirect先、および/ja/配下のnearest-404本文の言語は、" +
        "astro previewでは正しく再現されないため、Cloudflare PR Previewで別途確認する(手順24)。",
    );

    const unknownPaths = [
      "/this-page-does-not-exist",
      "/compress-image/unknown",
      "/404-test-12345",
      "/nonexistent-asset.js",
      "/ja/this-page-does-not-exist",
      "/ja/unknown-path",
    ];
    for (const p of unknownPaths) {
      const res = await fetch(`http://localhost:${port}${p}`);
      check(`GET ${p} -> 404`, res.status === 404, `実際: ${res.status}`);
    }

    // dist/404.html・dist/ja/404.htmlそのものが200で配信されること自体は、末尾スラッシュを
    // 付けた形("/404/"・"/ja/404/")であればastro previewでも確認できる(静的ファイルとしての
    // 疎通確認)。「/404」「/ja/404」という末尾スラッシュ無しの直接アクセスがCloudflare上で
    // 200になることは、本番での既存実績(英語/404)と同じ仕組み(フラットな404.htmlファイル)に
    // 日本語版も揃えたことで担保しており、Cloudflare PR Previewで最終確認する。
    const res404 = await fetch(`http://localhost:${port}/404/`);
    check(
      "GET /404/ (静的ファイル疎通確認) -> 200",
      res404.status === 200,
      `実際: ${res404.status}`,
    );
    if (res404.status === 200) {
      const body = await res404.text();
      check("GET /404/ の本文が英語404本文", body.includes("Page not found"));
    }

    const res404Ja = await fetch(`http://localhost:${port}/ja/404/`);
    check(
      "GET /ja/404/ (静的ファイル疎通確認) -> 200",
      res404Ja.status === 200,
      `実際: ${res404Ja.status}`,
    );
    if (res404Ja.status === 200) {
      const body = await res404Ja.text();
      check("GET /ja/404/ の本文が日本語404本文", body.includes("ページが見つかりません"));
    }
  }

  console.log(`\n合計失敗数: ${failures}`);
  await stopServerAndExit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await stopServerAndExit(1);
});
