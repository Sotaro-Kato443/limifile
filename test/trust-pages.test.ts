import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf-8");
}

const EN_ROUTES: Array<[string, string]> = [
  ["src/pages/privacy.astro", "PrivacyPage"],
  ["src/pages/terms.astro", "TermsPage"],
  ["src/pages/contact.astro", "ContactPage"],
];

const JA_ROUTES: Array<[string, string]> = [
  ["src/pages/ja/privacy.astro", "PrivacyPage"],
  ["src/pages/ja/terms.astro", "TermsPage"],
  ["src/pages/ja/contact.astro", "ContactPage"],
];

describe('英語route file(prefix無し)は薄い入口としてlocale="en"で共有ページを呼ぶだけ', () => {
  it.each(EN_ROUTES)('%s がlocale="en"で%sを呼ぶ', (relPath, componentName) => {
    expect(existsSync(path.join(root, relPath))).toBe(true);
    const source = readSrc(relPath);
    expect(source).toMatch(new RegExp(`<${componentName}\\s+locale="en"\\s*/>`));
  });
});

describe('日本語route file(/ja/配下)は薄い入口としてlocale="ja"で同じ共有ページを呼ぶだけ', () => {
  it.each(JA_ROUTES)('%s がlocale="ja"で%sを呼ぶ', (relPath, componentName) => {
    expect(existsSync(path.join(root, relPath))).toBe(true);
    const source = readSrc(relPath);
    expect(source).toMatch(new RegExp(`<${componentName}\\s+locale="ja"\\s*/>`));
  });
});

describe("英語・日本語route fileは同じ共有ページcomponentを参照している(重複実装なし)", () => {
  it.each(EN_ROUTES.map(([, name], i) => [name, EN_ROUTES[i][0], JA_ROUTES[i][0]] as const))(
    "%s は英語・日本語route両方から同一componentとしてimportされる",
    (componentName, enPath, jaPath) => {
      const enSource = readSrc(enPath);
      const jaSource = readSrc(jaPath);
      const enImportMatch = enSource.match(
        new RegExp(`import\\s+${componentName}\\s+from\\s+"([^"]+)"`),
      );
      const jaImportMatch = jaSource.match(
        new RegExp(`import\\s+${componentName}\\s+from\\s+"([^"]+)"`),
      );
      expect(enImportMatch).not.toBeNull();
      expect(jaImportMatch).not.toBeNull();
      const enTarget = enImportMatch?.[1].split("/").pop();
      const jaTarget = jaImportMatch?.[1].split("/").pop();
      expect(enTarget).toBe(jaTarget);
    },
  );
});

describe("/en/ ルートは作られていない", () => {
  it("src/pages/en/ ディレクトリが存在しない", () => {
    expect(existsSync(path.join(root, "src/pages/en"))).toBe(false);
  });
});

describe("共有ページcomponentはclient JSなし・astro-islandなし", () => {
  const sharedComponents = [
    "src/components/pages/PrivacyPage.astro",
    "src/components/pages/TermsPage.astro",
    "src/components/pages/ContactPage.astro",
  ];

  it.each(sharedComponents)("%s はclient:load・<script>を含まない", (relPath) => {
    const source = readSrc(relPath);
    expect(source).not.toContain("client:load");
    expect(source).not.toMatch(/<script[^>]*>/);
    expect(source).not.toContain("Workbench");
  });
});

describe("InfoPageLayout.astro — 実URLとpropsの一致検証・canonical/hreflang/x-default・noindex", () => {
  const source = readSrc("src/layouts/InfoPageLayout.astro");

  it("locale・pageKeyの両方を必須propsとして受け取る", () => {
    expect(source).toMatch(/locale:\s*ImplementedLocaleKey/);
    expect(source).toMatch(/pageKey:\s*InfoPageKey/);
  });

  it("Astro.url.pathnameから解決したlocale/keyとpropsが不一致なら例外を投げる", () => {
    expect(source).toContain("stripLocalePrefix(");
    expect(source).toContain("resolvePublicPageKeyStrict(");
    expect(source).toMatch(/throw new Error/);
  });

  it("canonical/hreflang/x-defaultをpublic-pages.tsの関数で生成する", () => {
    expect(source).toContain("buildLocalizedPagePath(locale, pageKey)");
    expect(source).toContain("buildPageAlternateUrls(origin, pageKey)");
    expect(source).toContain("buildXDefaultUrl(origin, pageKey)");
  });

  it("常にindexable=falseを渡す(page-level indexableを固定false)", () => {
    expect(source).toContain("resolveIsIndexable(globalIndexingEnabled, false)");
  });

  it("SoftwareApplicationのJSON-LD(structuredData)を渡さない", () => {
    expect(source).not.toContain("structuredData");
    expect(source).not.toContain("SoftwareApplication");
  });

  it("SiteNav・LanguageSwitcher・SiteFooterを組み込んでいる", () => {
    expect(source).toContain("<SiteNav");
    expect(source).toContain("<LanguageSwitcher");
    expect(source).toContain("<SiteFooter");
  });

  it("SiteNavへcurrentKeyを渡さない(信頼ページはツールナビの現在地対象外)", () => {
    expect(source).toMatch(/<SiteNav\s+locale=\{locale\}\s*\/>/);
  });
});

describe("SiteFooter.astro — en/ja4リンク・locale別href・aria-current・client JSなし", () => {
  const source = readSrc("src/components/SiteFooter.astro");

  it("licenses/privacy/terms/contactの4リンクをbuildLocalizedPagePathで生成する", () => {
    for (const key of ["licenses", "privacy", "terms", "contact"]) {
      expect(source).toContain(`buildLocalizedPagePath(locale, "${key}")`);
    }
  });

  it("currentKeyと一致するリンクへaria-current=pageを付ける", () => {
    expect(source).toMatch(/aria-current=\{currentKey === link\.key \? "page" : undefined\}/);
  });

  it("<script>タグ・client:loadを持たない", () => {
    expect(source).not.toMatch(/<script[^>]*>/);
    expect(source).not.toContain("client:load");
  });
});

describe("SiteNav.astro — currentKeyはoptionalで、省略時はツール現在地を付けない", () => {
  const navSource = readSrc("src/components/SiteNav.astro");

  it("SiteNav.astroのcurrentKey propはoptional(?)である", () => {
    expect(navSource).toMatch(/currentKey\?:\s*ToolPageKey/);
  });

  it("currentKeyとリンク先が一致する場合だけaria-currentを付ける", () => {
    expect(navSource).toContain('aria-current={currentKey === link.page ? "page" : undefined}');
  });

  it("信頼ページへクライアントJavaScriptを配布しない", () => {
    expect(navSource).not.toMatch(/<script[^>]*>/);
    expect(navSource).not.toContain("client:load");
  });
});

describe("LanguageSwitcher — 新規3ページでも同一ページ間を相互に切り替えられる", () => {
  it("LanguageSwitcher.astroはPublicPageKey全体を受け付け、privacy/terms/contactを除外しない", () => {
    const source = readSrc("src/components/LanguageSwitcher.astro");
    expect(source).toMatch(/pageKey:\s*PublicPageKey/);
  });
});

/**
 * READMEは英語(README.md)と日本語(README.ja.md)の2本立て。言語に依存しない事実は
 * 両方に対して同じ検査を行い、言語固有の表現だけを個別に検査する(片方だけ更新して
 * もう片方が古くなる、という形の破綻を検知するため)。
 */
const READMES = [
  { path: "README.md", label: "README.md(英語)" },
  { path: "README.ja.md", label: "README.ja.md(日本語)" },
] as const;

describe.each(READMES)("$label — 現状の実装を反映し、古い記述が残っていない", ({ path }) => {
  const readme = readSrc(path);

  it("Production URLを含む", () => {
    expect(readme).toContain("https://limifile.com/");
  });

  it("実装済みツールへの言及を含む", () => {
    for (const phrase of ["HEIC/HEIF", "500KB", "PNG", "WebP", "AVIF", "signature"]) {
      expect(readme.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("英語・日本語URL(/ja/を含む)への言及がある", () => {
    expect(readme).toContain("/ja/");
    expect(readme).toContain("/heic-to-jpg/");
  });

  it("Cloudflare Pagesで運用している旨の記載がある", () => {
    expect(readme).toContain("Cloudflare Pages");
  });

  it("現在のindexing方針(PUBLIC_ALLOW_INDEXING・AND条件)の説明がある", () => {
    expect(readme).toContain("PUBLIC_ALLOW_INDEXING");
    expect(readme).toContain("globalIndexingEnabled && pageIndexable");
    expect(readme).not.toMatch(/現在も検索公開前のnoindex状態/);
  });

  it("trust pagesと公開問い合わせ先(bunmeiproducts@gmail.com)への言及がある", () => {
    expect(readme).toContain("/privacy/");
    expect(readme).toContain("/terms/");
    expect(readme).toContain("/contact/");
    expect(readme).toContain("bunmeiproducts@gmail.com");
  });

  it("ライセンス構成(Apache-2.0・単一ライセンスではない旨・LICENSING.md)への言及がある", () => {
    expect(readme).toContain("Apache");
    expect(readme).toContain("LICENSING.md");
    expect(readme).toContain("TRADEMARKS.md");
  });

  it("もう一方の言語のREADMEへ相互リンクしている", () => {
    const other = path === "README.md" ? "README.ja.md" : "README.md";
    expect(readme).toContain(other);
  });

  /**
   * 公開snapshotではこのrepositoryのPR・Actions runへのリンクが辿れなくなるため、
   * READMEにそれらを書かない。検証の根拠は、リンクではなく再現手順として示す。
   */
  it("このrepositoryのPR・Actions runへのリンクを含まない", () => {
    expect(readme).not.toMatch(/github\.com\/Sotaro-Kato443\//);
    expect(readme).not.toContain("PR #22");
  });

  /** 内部の検索需要データ・市場名を公開ドキュメントへ持ち込まない */
  it("検索需要の内部データ・調査ツール名を含まない", () => {
    expect(readme).not.toMatch(/Keyword Planner/i);
    expect(readme).not.toContain("キーワードプランナー");
    expect(readme).not.toMatch(/\/mo\b/);
  });

  it("古い記述(TICKET-001/002、未実装機能の羅列、Cloudflare未接続の説明)が残っていない", () => {
    expect(readme).not.toContain("TICKET-001");
    expect(readme).not.toContain("TICKET-002");
    expect(readme).not.toContain("指定容量圧縮・EXIF/GPS削除・ZIP一括保存は未実装");
    expect(readme).not.toContain("この段階ではCloudflareダッシュボードの操作は行っていません");
    expect(readme).not.toContain("仮プロジェクト名");
  });

  it("buildがnested Japanese 404 fixupを含むことに言及している", () => {
    expect(readme).toContain("404");
    expect(readme.toLowerCase()).toContain("nearest-404");
  });
});

describe("READMEの言語固有表現", () => {
  const en = readSrc("README.md");
  const ja = readSrc("README.ja.md");

  it("README.mdは英語で書かれている(日本語の見出しを含まない)", () => {
    expect(en).toContain("## What it does");
    expect(en).toContain("## Privacy architecture");
    expect(en).not.toContain("## 実装済み機能");
  });

  it("README.ja.mdは日本語で書かれている", () => {
    expect(ja).toContain("## 実装済み機能");
    expect(ja).toContain("## プライバシー上の設計");
  });

  it("両READMEとも、Cloudflare側の環境変数の現在値をコードから断定していない", () => {
    expect(en).toMatch(/cannot be determined from this code alone/);
    expect(ja).toMatch(/コードだけから確認することはできません/);
  });
});

describe("scripts/verify-trust-pages.mjs と package.json の配線", () => {
  it("package.jsonにverify:trust-pagesスクリプトが存在する", () => {
    const packageJson = JSON.parse(readSrc("package.json")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:trust-pages"]).toBe("node scripts/verify-trust-pages.mjs");
  });

  it("CI workflowがverify:trust-pagesを実行する", () => {
    const ciWorkflow = readSrc(".github/workflows/ci.yml");
    expect(ciWorkflow).toContain("npm run verify:trust-pages");
  });
});
