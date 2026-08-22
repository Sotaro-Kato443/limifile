import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getToolCards, resolveNavItems } from "../src/config/tool-page-config";
import { ja } from "../src/i18n/dictionaries/ja";

const routeEn = readFileSync(path.join(process.cwd(), "src/pages/licenses.astro"), "utf-8");
const routeJa = readFileSync(path.join(process.cwd(), "src/pages/ja/licenses.astro"), "utf-8");
const licensesPageSource = readFileSync(
  path.join(process.cwd(), "src/components/pages/LicensesPage.astro"),
  "utf-8",
);
const contentJa = readFileSync(
  path.join(process.cwd(), "src/components/licenses/LicensesContentJa.astro"),
  "utf-8",
);
const contentEn = readFileSync(
  path.join(process.cwd(), "src/components/licenses/LicensesContentEn.astro"),
  "utf-8",
);
const baseLayoutSource = readFileSync(
  path.join(process.cwd(), "src/layouts/BaseLayout.astro"),
  "utf-8",
);
const packageLock = JSON.parse(
  readFileSync(path.join(process.cwd(), "package-lock.json"), "utf-8"),
) as { packages: Record<string, { version?: string }> };

function lockedVersion(pkg: string): string {
  const entry = packageLock.packages[`node_modules/${pkg}`];
  if (!entry?.version) {
    throw new Error(`package-lock.jsonに ${pkg} のエントリが見つかりません`);
  }
  return entry.version;
}

describe("src/pages/licenses.astro(英語root)・src/pages/ja/licenses.astro(日本語)", () => {
  it("両方存在し、共有LicensesPageコンポーネントをlocaleだけ変えて呼び出す薄い入口である", () => {
    expect(routeEn.length).toBeGreaterThan(0);
    expect(routeJa.length).toBeGreaterThan(0);
    expect(routeEn).toMatch(/<LicensesPage\s+locale="en"\s*\/>/);
    expect(routeJa).toMatch(/<LicensesPage\s+locale="ja"\s*\/>/);
  });
});

describe("src/components/pages/LicensesPage.astro(共有実装)", () => {
  it("noindex, nofollowを常に含む", () => {
    expect(licensesPageSource).toMatch(/<BaseLayout[^>]*\bindexable=\{false\}/s);
    expect(baseLayoutSource).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("localeごとのtitleを持つ(TITLES[locale])", () => {
    expect(licensesPageSource).toContain('en: "Open Source Licenses"');
    expect(licensesPageSource).toContain('ja: "オープンソースライセンス"');
  });

  it("h1が1つだけで、TITLES[locale]を表示する", () => {
    const matches = licensesPageSource.match(/<h1[^>]*>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(licensesPageSource).toContain("<h1>{TITLES[locale]}</h1>");
  });

  it("locale別canonical/hreflang/x-defaultをbuildPageAlternateUrls等で生成している", () => {
    expect(licensesPageSource).toContain('buildLocalizedPagePath(locale, "licenses")');
    expect(licensesPageSource).toContain('buildPageAlternateUrls(origin, "licenses")');
    expect(licensesPageSource).toContain('buildXDefaultUrl(origin, "licenses")');
  });

  it("画像処理コンポーネントをclient:loadディレクティブ付きで読み込まない", () => {
    expect(licensesPageSource).not.toMatch(/<[A-Z][A-Za-z]*[^>]*\sclient:load/);
    expect(licensesPageSource).not.toMatch(/Workbench/);
    expect(contentEn).not.toMatch(/<[A-Z][A-Za-z]*[^>]*\sclient:load/);
    expect(contentJa).not.toMatch(/<[A-Z][A-Za-z]*[^>]*\sclient:load/);
  });

  it("lang・viewport・faviconを持つ(BaseLayout経由)", () => {
    expect(licensesPageSource).toMatch(/<BaseLayout[^>]*\slocale=\{locale\}/s);
    expect(baseLayoutSource).toContain("<html lang={localeDefinition.htmlLang}>");
    expect(baseLayoutSource).toContain('name="viewport"');
    expect(baseLayoutSource).toContain('rel="icon"');
  });
});

describe("両言語のdependency事実parity", () => {
  const factChecks: Array<[string, string]> = [
    ["@discourse/heic", "1.0.0"],
    ["libheif", "1.19.7"],
    ["libde265", "1.0.15"],
    ["@upng/upng-js", "2.2.2"],
    ["pako", "2.2.0"],
  ];

  it.each(factChecks)("両言語が%sとそのversion(%s)を含む", (name, version) => {
    for (const source of [contentJa, contentEn]) {
      expect(source).toContain(name);
      expect(source).toContain(version);
    }
  });

  it("両言語がHEIC WASMの静的リンクを説明している", () => {
    expect(contentJa).toContain("静的リンク");
    expect(contentEn).toMatch(/statically link/);
  });

  it("両言語がx265等の他コーデックを含まない旨、デコードのみ行う旨を説明している", () => {
    expect(contentJa).toContain("x265");
    expect(contentJa).toMatch(/デコード(?:のみ|\(読み込み\)のみ)/);
    expect(contentEn).toContain("x265");
    expect(contentEn).toMatch(/decodes?\s*\(reads?\)/i);
    expect(contentEn).toMatch(/does not encode/i);
  });

  it("両言語が「完全準拠」「LGPL対応済み」等の断定表現を含まない", () => {
    const forbiddenJa = [
      "完全準拠",
      "LGPL対応済み",
      "準拠済み",
      "法的問題はない",
      "法的義務を満たしている",
    ];
    for (const phrase of forbiddenJa) {
      expect(contentJa).not.toContain(phrase);
    }
    const forbiddenEn = [
      "fully compliant",
      "LGPL compliant",
      "no legal issues",
      "satisfies all legal obligations",
    ];
    for (const phrase of forbiddenEn) {
      expect(contentEn.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it("両言語がsource packageへの言及と、自己レビューに基づく旨の事実限定表現を含む", () => {
    for (const source of [contentJa, contentEn]) {
      expect(source).toContain("filefit-heic-decoder-1.0.0-source.tar.gz");
    }
    expect(contentJa).toContain("FileFitの技術・ライセンス自己レビューに基づく");
    expect(contentJa).toContain(
      "外部法律専門家による確認、法的助言、法的十分性の保証を意味しません",
    );
    expect(contentJa).toMatch(/LGPL対応が完了したこと[\s\S]*断定しません/);
    expect(contentEn).toMatch(/FileFit's own technical and license self-review/);
    const normalizedEn = contentEn.replace(/\s+/g, " ");
    expect(normalizedEn).toContain(
      "does not represent confirmation by an outside legal professional, legal advice, or a guarantee of legal sufficiency",
    );
    expect(normalizedEn).toContain("does not assert that LGPL compliance has been completed");
  });

  it("著作権者(jamsinclair)が両言語のライセンスエントリ内に表示されている", () => {
    expect(contentJa).toContain("jamsinclair");
    expect(contentEn).toContain("jamsinclair");
  });

  it("両言語が同じanchor id(heic-heading・png-heading・ui-heading・build-heading)を持つ(相互リンク先の一致)", () => {
    for (const anchor of ["heic-heading", "png-heading", "ui-heading", "build-heading"]) {
      expect(contentJa).toContain(`id="${anchor}"`);
      expect(contentEn).toContain(`id="${anchor}"`);
    }
  });

  it("両言語が各ライセンス全文ファイルへの同一hrefを含む(locale prefixを付けない)", () => {
    const expectedLinks = [
      "/licenses/apache-2.0.txt",
      "/licenses/lgpl-3.0.txt",
      "/licenses/gpl-3.0.txt",
      "/licenses/mit-upng.txt",
      "/licenses/mit-pako.txt",
      "/licenses/mit-preact.txt",
      "/licenses/mit-preact-signals.txt",
      "/licenses/mit-astro.txt",
    ];
    for (const href of expectedLinks) {
      expect(contentJa).toContain(`href="${href}"`);
      expect(contentEn).toContain(`href="${href}"`);
    }
  });

  it("両言語がsource package assetへの同一href(locale prefix無し)を含む", () => {
    expect(contentJa).toContain('href="/source/filefit-heic-decoder-1.0.0-source.tar.gz"');
    expect(contentEn).toContain('href="/source/filefit-heic-decoder-1.0.0-source.tar.gz"');
  });

  it("日本語コンテンツに「全ページでブラウザへ配布」という不正確な表現を含まない", () => {
    expect(contentJa).not.toContain("全ページでブラウザへ配布");
  });

  it("両言語がclient:loadページ(7ページ×2locale)と静的ページ(404・licenses)を区別して説明している", () => {
    expect(contentJa).toContain("client:load");
    expect(contentJa).toMatch(/静的なHTML・CSSのみ/);
    expect(contentEn).toContain("client:load");
    expect(contentEn).toMatch(/static\s+HTML\/CSS-only pages/);
  });

  it("両言語がAstroの「静的サイト生成」部分と「Astro Islandクライアントランタイム」を区別している", () => {
    expect(contentJa).toContain("Astro Islandクライアントランタイム");
    expect(contentJa).toContain("静的サイト生成・コンパイラ部分");
    expect(contentEn).toContain("Astro Island client runtime");
    expect(contentEn).toMatch(/static site generation.*compiler part/i);
  });

  it("両言語が@preact/signalsについて、実際には現状読み込まれない旨を説明している", () => {
    expect(contentJa).toMatch(/読み込まれない/);
    expect(contentEn).toMatch(/not\s+actually fetched/);
  });
});

describe("public/licenses/ ライセンス全文ファイルが存在する(locale非依存の共有asset)", () => {
  const files = [
    "apache-2.0.txt",
    "lgpl-3.0.txt",
    "gpl-3.0.txt",
    "mit-upng.txt",
    "mit-pako.txt",
    "mit-preact.txt",
    "mit-preact-signals.txt",
    "mit-astro.txt",
  ];

  for (const file of files) {
    it(`public/licenses/${file}が存在し、空でない`, () => {
      const filePath = path.join(process.cwd(), "public/licenses", file);
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf-8").length).toBeGreaterThan(0);
    });
  }

  it("apache-2.0.txtはcanonicalなApache License本文を含み、特定プロジェクトの著作権表示は含まない", () => {
    const content = readFileSync(
      path.join(process.cwd(), "public/licenses/apache-2.0.txt"),
      "utf-8",
    );
    expect(content).toContain("Apache License");
    expect(content).not.toContain("jamsinclair");
  });

  it("lgpl-3.0.txtはLGPL v3の本文を含む", () => {
    const content = readFileSync(path.join(process.cwd(), "public/licenses/lgpl-3.0.txt"), "utf-8");
    expect(content).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
    expect(content).toContain("Version 3");
  });

  it("gpl-3.0.txtはGPL v3の本文を含む", () => {
    const content = readFileSync(path.join(process.cwd(), "public/licenses/gpl-3.0.txt"), "utf-8");
    expect(content).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(content).toContain("Version 3");
  });

  it("mit-upng.txtはPhotopeaの著作権表示を維持している", () => {
    const content = readFileSync(path.join(process.cwd(), "public/licenses/mit-upng.txt"), "utf-8");
    expect(content).toContain("Copyright (c) 2017 Photopea");
  });

  it("mit-pako.txtはVitaly Puzrin / Andrei Tuputcynの著作権表示を維持している", () => {
    const content = readFileSync(path.join(process.cwd(), "public/licenses/mit-pako.txt"), "utf-8");
    expect(content).toContain("Vitaly Puzrin");
    expect(content).toContain("Andrei Tuputcyn");
  });
});

describe("package-lock.jsonとの整合性(dependency version drift検知、両言語)", () => {
  const versionChecks: Array<[string]> = [
    ["@discourse/heic"],
    ["@upng/upng-js"],
    ["pako"],
    ["preact"],
    ["@preact/signals"],
    ["@preact/signals-core"],
    ["@astrojs/preact"],
    ["astro"],
  ];

  it.each(versionChecks)("%sのバージョンが両言語licensesコンテンツの記載と一致する", (pkg) => {
    const version = lockedVersion(pkg);
    expect(contentJa).toContain(version);
    expect(contentEn).toContain(version);
  });
});

describe("footer導線", () => {
  it("SiteFooter.astroがlocale別の/licensesへのリンクを持つ(buildLocalizedPagePath経由)", () => {
    const footerSource = readFileSync(
      path.join(process.cwd(), "src/components/SiteFooter.astro"),
      "utf-8",
    );
    expect(footerSource).toContain('buildLocalizedPagePath(locale, "licenses")');
    expect(footerSource).toContain("dictionary.footer.licenses");
    expect(ja.footer.licenses).toBe("オープンソースライセンス");
  });

  it("ToolPageLayout.astroがSiteFooterを読み込む(既存14ページ=7ページ×2localeに反映される)", () => {
    const layoutSource = readFileSync(
      path.join(process.cwd(), "src/layouts/ToolPageLayout.astro"),
      "utf-8",
    );
    expect(layoutSource).toContain("SiteFooter");
  });

  it("NotFoundPage.astroがSiteFooterを読み込む", () => {
    const notFoundSource = readFileSync(
      path.join(process.cwd(), "src/components/pages/NotFoundPage.astro"),
      "utf-8",
    );
    expect(notFoundSource).toContain("SiteFooter");
  });
});

describe("/licensesは通常のツールナビゲーション・ツールカードに追加されていない", () => {
  it("resolveNavItemsは引き続き7件のみで、/licensesを含まない", () => {
    const items = resolveNavItems("ja", "default");
    expect(items).toHaveLength(7);
    expect(items.map((item) => item.href)).not.toContain("/ja/licenses/");
  });

  it("getToolCardsは引き続き8件のみで、/licensesを含まない", () => {
    const cards = getToolCards("ja");
    expect(cards).toHaveLength(8);
    expect(cards.map((card) => card.href)).not.toContain("/ja/licenses/");
  });
});

describe("mit-astro.txt(astro・@astrojs/preact共通のMITライセンス全文)", () => {
  it("旧ファイル名mit-astrojs-preact.txtは存在しない(mit-astro.txtへ整理済み)", () => {
    const oldPath = path.join(process.cwd(), "public/licenses/mit-astrojs-preact.txt");
    expect(existsSync(oldPath)).toBe(false);
  });

  it("mit-astro.txtは astro パッケージのLICENSEと内容が一致する", () => {
    const content = readFileSync(
      path.join(process.cwd(), "public/licenses/mit-astro.txt"),
      "utf-8",
    );
    const astroLicense = readFileSync(
      path.join(process.cwd(), "node_modules/astro/LICENSE"),
      "utf-8",
    );
    expect(content).toBe(astroLicense);
  });

  it("mit-astro.txtは @astrojs/preact パッケージのLICENSEとも内容が一致する(同一ファイルのため)", () => {
    const content = readFileSync(
      path.join(process.cwd(), "public/licenses/mit-astro.txt"),
      "utf-8",
    );
    const astrojsPreactLicense = readFileSync(
      path.join(process.cwd(), "node_modules/@astrojs/preact/LICENSE"),
      "utf-8",
    );
    expect(content).toBe(astrojsPreactLicense);
  });
});

describe("THIRD_PARTY_NOTICES.md", () => {
  const notices = readFileSync(path.join(process.cwd(), "THIRD_PARTY_NOTICES.md"), "utf-8");

  it("Preact関連dependencyに不正確な「あり(全ページ)」という表現が残っていない", () => {
    expect(notices).not.toContain("あり(全ページ)");
  });

  it("Astroの静的サイト生成・コンパイラ部分とAstro Islandクライアントランタイムを区別している", () => {
    expect(notices).toContain("Astro Islandクライアントランタイム");
    expect(notices).toContain("静的HTML生成・コンパイル部分");
  });

  it("開発専用dependencyについて、grepだけを根拠にした断定表現を使っていない", () => {
    expect(notices).not.toContain(
      "Production配布物(`dist/`)には一切含まれないことを`grep`で確認済みです。",
    );
  });

  it("ページ別のクライアント配布物の実測結果を記載している", () => {
    expect(notices).toContain("ページ別のクライアント配布物");
    expect(notices).toMatch(/signals\.module.*fetchされません/s);
  });

  it("@discourse/heic・libheif・libde265・静的リンク・x265非搭載の説明を維持している", () => {
    expect(notices).toContain("@discourse/heic");
    expect(notices).toContain("1.19.7");
    expect(notices).toContain("1.0.15");
    expect(notices).toContain("静的リンク");
    expect(notices).toContain("x265");
  });

  it("LGPL関連の残余の法的解釈リスクの説明を維持している", () => {
    expect(notices).toContain("残余の法的解釈リスク");
    expect(notices).toContain("Corresponding Application Codeの範囲");
    expect(notices).toContain("外部法律専門家による確認を経ていません");
  });

  it("LGPL対応ソースpackageの情報を、自己レビューに基づく旨とともに記載している", () => {
    expect(notices).toContain("filefit-heic-decoder-1.0.0-source.tar.gz");
    expect(notices).toContain("FileFitの技術・ライセンス自己レビューに基づいて提供している");
    expect(notices).not.toContain("専門家確認前");
    expect(notices).not.toContain("専門家確認待ち");
    expect(notices).not.toContain("DO NOT MERGE");
  });
});

describe("CIワークフローでのビルド成果物検証", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
  ) as { scripts: Record<string, string> };
  const ciWorkflow = readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");

  it("package.jsonにverify:licensesスクリプトが存在する", () => {
    expect(packageJson.scripts["verify:licenses"]).toBe("node scripts/verify-licenses.mjs");
  });

  it("CI workflowが npm run verify:licenses を実行する", () => {
    expect(ciWorkflow).toContain("npm run verify:licenses");
  });

  it("「Verify license distribution」stepが存在し、Buildより後に定義されている", () => {
    const buildIndex = ciWorkflow.indexOf("name: Build");
    const verify404Index = ciWorkflow.indexOf("name: Verify 404 handling");
    const verifyLicensesIndex = ciWorkflow.indexOf("name: Verify license distribution");
    expect(buildIndex).toBeGreaterThan(-1);
    expect(verify404Index).toBeGreaterThan(-1);
    expect(verifyLicensesIndex).toBeGreaterThan(-1);
    expect(verify404Index).toBeGreaterThan(buildIndex);
    expect(verifyLicensesIndex).toBeGreaterThan(verify404Index);
  });
});

describe("scripts/verify-licenses.mjs", () => {
  const scriptSource = readFileSync(
    path.join(process.cwd(), "scripts/verify-licenses.mjs"),
    "utf-8",
  );

  it("dist/の存在チェック後、無ければビルドするが、既に存在する場合は再ビルドしない設計を維持している", () => {
    expect(scriptSource).toContain("if (!existsSync(distDir))");
  });

  it("signals.module.*.jsファイルの不存在ではなく、data-preact-signals属性の不在で判定している", () => {
    expect(scriptSource).toContain("data-preact-signals");
    expect(scriptSource).not.toMatch(/existsSync\([^)]*signals\.module/);
  });

  it("dist/配下のHTMLを再帰的に列挙して検査している(将来ページ追加にも対応)", () => {
    expect(scriptSource).toContain("listHtmlFiles");
  });

  it("英語・日本語の/404と/licensesがクライアントJSを読み込まないことを検証している", () => {
    expect(scriptSource).toContain("staticOnlyPages");
    expect(scriptSource).toContain("astro-islandが存在しない(静的ページ)");
    expect(scriptSource).toContain("ja/404.html");
    expect(scriptSource).toContain("ja/licenses/index.html");
  });
});
