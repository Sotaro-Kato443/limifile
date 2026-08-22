#!/usr/bin/env node
/**
 * Astroはトップレベルのsrc/pages/404.astroだけを特別扱いし、trailingSlash設定に関わらず
 * 常にdist/404.html(フラットファイル)として出力する。一方、src/pages/ja/404.astroのような
 * ネストしたpage fileはこの特別扱いを受けず、trailingSlash: "always"の下ではdist/ja/404/index.html
 * として出力されてしまう。
 *
 * Cloudflare Pagesは要求されたパスから最も近い404.htmlをディレクトリを遡って探す仕様のため、
 * /ja/配下のいずれのパスでも日本語404が使われるようにするには、dist/ja/404.html という
 * フラットファイルが実在する必要がある。このスクリプトはbuild後に、ネストした404/index.htmlを
 * 同名の404.htmlへ移動し、空になった404/ディレクトリを削除する。
 *
 * 使い方: npm run buildの一部として自動実行される(astro build && node scripts/fix-nested-404-output.mjs)
 */
import { existsSync, renameSync, rmdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(rootDir, "dist");

/** dist直下の、トップレベル404.astro以外のlocaleディレクトリ(現時点ではjaのみ)を対象にする */
const NESTED_LOCALE_DIRS = ["ja"];

let fixedCount = 0;
for (const localeDir of NESTED_LOCALE_DIRS) {
  const nestedIndexPath = path.join(distDir, localeDir, "404", "index.html");
  const flatPath = path.join(distDir, localeDir, "404.html");
  if (!existsSync(nestedIndexPath)) {
    continue;
  }
  renameSync(nestedIndexPath, flatPath);
  const nestedDir = path.join(distDir, localeDir, "404");
  if (existsSync(nestedDir) && readdirSync(nestedDir).length === 0) {
    rmdirSync(nestedDir);
  }
  console.log(
    `[fix-nested-404-output] dist/${localeDir}/404/index.html -> dist/${localeDir}/404.html`,
  );
  fixedCount += 1;
}

if (fixedCount === 0) {
  console.log("[fix-nested-404-output] 対象のネスト404出力は見つかりませんでした(変更なし)");
}
