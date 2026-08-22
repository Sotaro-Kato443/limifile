import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf-8");
}

// compress-image-to-500kb(en/ja)は他ページと異なりFixedTargetCompressionPageへ
// pageKey・targetKBも渡すため、`<Component locale="xx" />`という単純な自己終了パターンに
// 一致しない。このため下のEN_ROUTES/JA_ROUTES(単純パターン専用)には含めず、
// 固定容量ページ専用のdescribeブロックで個別に検証する。
const EN_ROUTES: Array<[string, string]> = [
  ["src/pages/index.astro", "HomePage"],
  ["src/pages/heic-to-jpg.astro", "HeicToJpgPage"],
  ["src/pages/compress-image.astro", "CompressImagePage"],
  ["src/pages/remove-exif.astro", "RemoveExifPage"],
  ["src/pages/png-to-webp.astro", "PngToWebpPage"],
  ["src/pages/compress-png.astro", "PngCompressionPage"],
  ["src/pages/licenses.astro", "LicensesPage"],
  ["src/pages/404.astro", "NotFoundPage"],
];

const JA_ROUTES: Array<[string, string]> = [
  ["src/pages/ja/index.astro", "HomePage"],
  ["src/pages/ja/heic-to-jpg.astro", "HeicToJpgPage"],
  ["src/pages/ja/compress-image.astro", "CompressImagePage"],
  ["src/pages/ja/remove-exif.astro", "RemoveExifPage"],
  ["src/pages/ja/png-to-webp.astro", "PngToWebpPage"],
  ["src/pages/ja/compress-png.astro", "PngCompressionPage"],
  ["src/pages/ja/licenses.astro", "LicensesPage"],
  ["src/pages/ja/404.astro", "NotFoundPage"],
];

/**
 * 固定容量ページ(20/50/100/200/500KB)。500KBのみen/ja両方で、残り4件は英語のみ
 * (日本語版route fileを意図的に作らない)。
 */
const FIXED_TARGET_ROUTES: Array<{
  path: string;
  locale: "en" | "ja";
  pageKey: string;
  targetKB: number;
}> = [
  {
    path: "src/pages/compress-image-to-500kb.astro",
    locale: "en",
    pageKey: "compress-image-to-500kb",
    targetKB: 500,
  },
  {
    path: "src/pages/ja/compress-image-to-500kb.astro",
    locale: "ja",
    pageKey: "compress-image-to-500kb",
    targetKB: 500,
  },
  {
    path: "src/pages/compress-image-to-20kb.astro",
    locale: "en",
    pageKey: "compress-image-to-20kb",
    targetKB: 20,
  },
  {
    path: "src/pages/compress-image-to-50kb.astro",
    locale: "en",
    pageKey: "compress-image-to-50kb",
    targetKB: 50,
  },
  {
    path: "src/pages/compress-image-to-100kb.astro",
    locale: "en",
    pageKey: "compress-image-to-100kb",
    targetKB: 100,
  },
  {
    path: "src/pages/compress-image-to-200kb.astro",
    locale: "en",
    pageKey: "compress-image-to-200kb",
    targetKB: 200,
  },
];

/**
 * PNG→JPG・WebP→JPG(en/ja両方)・AVIF→JPG(英語専用)。png-to-webp/heic-to-jpg等と異なり、
 * 共有RasterToJpgPageへpageKey・sourceFormat・sourceFormatLabelも渡すため、
 * `<Component locale="xx" />`という単純な自己終了パターン(EN_ROUTES/JA_ROUTES)には一致しない。
 * 固定容量ページと同様、専用のdescribeブロックで個別に検証する。
 * avif-to-jpgは固定容量4ページと同じく英語専用で、日本語版route fileを作らない。
 */
const RASTER_TO_JPG_ROUTES: Array<{
  path: string;
  locale: "en" | "ja";
  pageKey: "png-to-jpg" | "webp-to-jpg" | "avif-to-jpg";
  sourceFormat: "png" | "webp" | "avif";
  sourceFormatLabel: string;
}> = [
  {
    path: "src/pages/png-to-jpg.astro",
    locale: "en",
    pageKey: "png-to-jpg",
    sourceFormat: "png",
    sourceFormatLabel: "PNG",
  },
  {
    path: "src/pages/ja/png-to-jpg.astro",
    locale: "ja",
    pageKey: "png-to-jpg",
    sourceFormat: "png",
    sourceFormatLabel: "PNG",
  },
  {
    path: "src/pages/webp-to-jpg.astro",
    locale: "en",
    pageKey: "webp-to-jpg",
    sourceFormat: "webp",
    sourceFormatLabel: "WebP",
  },
  {
    path: "src/pages/ja/webp-to-jpg.astro",
    locale: "ja",
    pageKey: "webp-to-jpg",
    sourceFormat: "webp",
    sourceFormatLabel: "WebP",
  },
  {
    path: "src/pages/avif-to-jpg.astro",
    locale: "en",
    pageKey: "avif-to-jpg",
    sourceFormat: "avif",
    sourceFormatLabel: "AVIF",
  },
];

describe("PNG→JPG・WebP→JPG・AVIF→JPG — RasterToJpgPageをpageKey・sourceFormat付きで呼ぶ", () => {
  it.each(RASTER_TO_JPG_ROUTES)(
    '$path がlocale="$locale" pageKey="$pageKey" sourceFormat="$sourceFormat"でRasterToJpgPageを呼ぶ',
    ({ path: relPath, locale, pageKey, sourceFormat, sourceFormatLabel }) => {
      expect(existsSync(path.join(root, relPath))).toBe(true);
      const source = readSrc(relPath);
      expect(source).toContain("RasterToJpgPage");
      expect(source).toMatch(
        new RegExp(
          `<RasterToJpgPage\\s+locale="${locale}"\\s+pageKey="${pageKey}"\\s+sourceFormat="${sourceFormat}"\\s+sourceFormatLabel="${sourceFormatLabel}"\\s*/>`,
        ),
      );
      expect(source).not.toContain("Workbench");
    },
  );

  it("png-to-jpg・webp-to-jpgはどちらも同一のRasterToJpgPage componentを共有している(重複実装なし)", () => {
    for (const { path: relPath } of RASTER_TO_JPG_ROUTES) {
      const source = readSrc(relPath);
      const importMatch = source.match(/import\s+RasterToJpgPage\s+from\s+"([^"]+)"/);
      expect(importMatch).not.toBeNull();
      expect(importMatch?.[1].split("/").pop()).toBe("RasterToJpgPage.astro");
    }
  });

  it("png-to-jpg・webp-to-jpgは(固定容量4ページと異なり)日本語版route fileも存在する", () => {
    for (const slug of ["png-to-jpg", "webp-to-jpg"]) {
      expect(existsSync(path.join(root, `src/pages/ja/${slug}.astro`))).toBe(true);
    }
  });

  it("avif-to-jpgは固定容量4ページと同じ理由で日本語版route fileを作らない", () => {
    expect(existsSync(path.join(root, "src/pages/ja/avif-to-jpg.astro"))).toBe(false);
  });
});

describe('Signature Resizer — 薄い入口としてlocale="en"でSignatureResizerPageを呼ぶ(英語専用)', () => {
  it('src/pages/signature-resizer.astro がlocale="en"でSignatureResizerPageを呼ぶ', () => {
    const relPath = "src/pages/signature-resizer.astro";
    expect(existsSync(path.join(root, relPath))).toBe(true);
    const source = readSrc(relPath);
    expect(source).toMatch(/<SignatureResizerPage\s+locale="en"\s*\/>/);
    expect(source).not.toContain("Workbench");
  });

  it("signature-resizerは固定容量4ページ・avif-to-jpgと同じ理由で日本語版route fileを作らない", () => {
    expect(existsSync(path.join(root, "src/pages/ja/signature-resizer.astro"))).toBe(false);
  });
});

describe("固定容量ページ(20/50/100/200/500KB) — FixedTargetCompressionPageをpageKey・targetKB付きで呼ぶ", () => {
  it.each(FIXED_TARGET_ROUTES)(
    '$path がlocale="$locale" pageKey="$pageKey" targetKB={$targetKB}でFixedTargetCompressionPageを呼ぶ',
    ({ path: relPath, locale, pageKey, targetKB }) => {
      expect(existsSync(path.join(root, relPath))).toBe(true);
      const source = readSrc(relPath);
      expect(source).toContain("FixedTargetCompressionPage");
      expect(source).toMatch(
        new RegExp(
          `<FixedTargetCompressionPage\\s+locale="${locale}"\\s+pageKey="${pageKey}"\\s+targetKB=\\{${targetKB}\\}\\s*/>`,
        ),
      );
      expect(source).not.toContain("Workbench");
    },
  );

  it("固定容量4ページ(20/50/100/200KB)には日本語版route fileが存在しない(意図的)", () => {
    for (const slug of [
      "compress-image-to-20kb",
      "compress-image-to-50kb",
      "compress-image-to-100kb",
      "compress-image-to-200kb",
    ]) {
      expect(existsSync(path.join(root, `src/pages/ja/${slug}.astro`))).toBe(false);
    }
  });

  it("固定容量5ページすべてが同一のFixedTargetCompressionPage componentを共有している(重複実装なし)", () => {
    for (const { path: relPath } of FIXED_TARGET_ROUTES) {
      const source = readSrc(relPath);
      const importMatch = source.match(/import\s+FixedTargetCompressionPage\s+from\s+"([^"]+)"/);
      expect(importMatch).not.toBeNull();
      expect(importMatch?.[1].split("/").pop()).toBe("FixedTargetCompressionPage.astro");
    }
  });
});

describe('英語route file(prefix無し)は薄い入口としてlocale="en"で共有ページを呼ぶだけ', () => {
  it.each(EN_ROUTES)('%s がlocale="en"で%sを呼ぶ', (relPath, componentName) => {
    expect(existsSync(path.join(root, relPath))).toBe(true);
    const source = readSrc(relPath);
    expect(source).toMatch(new RegExp(`<${componentName}\\s+locale="en"\\s*/>`));
    // 画像処理・Workbench実装を複製していない(importが共有componentだけであること)
    expect(source).not.toContain("Workbench");
  });
});

describe('日本語route file(/ja/配下)は薄い入口としてlocale="ja"で同じ共有ページを呼ぶだけ', () => {
  it.each(JA_ROUTES)('%s がlocale="ja"で%sを呼ぶ', (relPath, componentName) => {
    expect(existsSync(path.join(root, relPath))).toBe(true);
    const source = readSrc(relPath);
    expect(source).toMatch(new RegExp(`<${componentName}\\s+locale="ja"\\s*/>`));
    expect(source).not.toContain("Workbench");
  });
});

describe("英語・日本語のroute fileは同じ共有ページcomponentを参照している(重複実装なし)", () => {
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
      // 相対pathの深さ(../ vs ../../)は異なるが、指す先の共有componentファイル名は同一
      const enTarget = enImportMatch?.[1].split("/").pop();
      const jaTarget = jaImportMatch?.[1].split("/").pop();
      expect(enTarget).toBe(jaTarget);
    },
  );
});

describe("共有ページcomponentは全island rootへlocaleをそのまま渡す", () => {
  const pageComponentsWithWorkbench: Array<[string, string]> = [
    ["src/components/pages/HomePage.astro", "ImageWorkbench"],
    ["src/components/pages/HeicToJpgPage.astro", "ImageWorkbench"],
    ["src/components/pages/CompressImagePage.astro", "CompressWorkbench"],
    ["src/components/pages/FixedTargetCompressionPage.astro", "FixedTargetCompressionWorkbench"],
    ["src/components/pages/RemoveExifPage.astro", "RemoveExifWorkbench"],
    ["src/components/pages/PngToWebpPage.astro", "PngToWebpWorkbench"],
    ["src/components/pages/PngCompressionPage.astro", "PngCompressionWorkbench"],
    ["src/components/pages/RasterToJpgPage.astro", "RasterToJpgWorkbench"],
    ["src/components/pages/SignatureResizerPage.astro", "SignatureResizerWorkbench"],
  ];

  it.each(pageComponentsWithWorkbench)(
    "%s の%sはclient:load locale={locale}を受け取る",
    (relPath, workbenchName) => {
      const source = readSrc(relPath);
      expect(source).toMatch(new RegExp(`<${workbenchName}\\s+client:load\\s+locale=\\{locale\\}`));
    },
  );
});

describe("ToolPageLayout — 実URLとpropsの一致を検証する(未知パスの暗黙fallbackを避ける)", () => {
  const layoutSource = readSrc("src/layouts/ToolPageLayout.astro");

  it("locale・pageKeyの両方を必須propsとして受け取る", () => {
    expect(layoutSource).toMatch(/locale:\s*ImplementedLocaleKey/);
    expect(layoutSource).toMatch(/pageKey:\s*ToolPageKey/);
  });

  it("Astro.url.pathnameから解決したlocale/keyとpropsが不一致なら例外を投げる", () => {
    expect(layoutSource).toContain("stripLocalePrefix(");
    expect(layoutSource).toContain("resolvePublicPageKeyStrict(");
    expect(layoutSource).toMatch(/throw new Error/);
  });

  it("canonical/hreflang/x-defaultをpublic-pages.tsの関数で生成する", () => {
    expect(layoutSource).toContain("buildLocalizedPagePath(locale, pageKey)");
    expect(layoutSource).toContain("buildPageAlternateUrls(origin, pageKey)");
    expect(layoutSource).toContain("buildXDefaultUrl(origin, pageKey)");
  });

  it("SiteNav・LanguageSwitcherを組み込んでいる", () => {
    expect(layoutSource).toContain("<SiteNav");
    expect(layoutSource).toContain("<LanguageSwitcher");
  });
});

describe("LanguageSwitcher.astro — 静的・JSなしの相互リンク", () => {
  const source = readSrc("src/components/LanguageSwitcher.astro");

  it("<script>タグを持たない(JavaScriptなし)", () => {
    expect(source).not.toMatch(/<script[^>]*>/);
  });

  it("localStorage・cookie・navigator.languageを使用しない", () => {
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("document.cookie");
    expect(source).not.toContain("navigator.language");
  });

  it("ACTIVE_LOCALES(en/ja)だけを対象にし、reserved localeを含まない", () => {
    expect(source).toContain("ACTIVE_LOCALES");
    expect(source).not.toContain("RESERVED_LOCALES");
  });

  it("各リンクへaria-current・lang・hreflangを付与する", () => {
    expect(source).toContain('aria-current={definition.key === locale ? "page" : undefined}');
    expect(source).toContain("lang={definition.htmlLang}");
    expect(source).toContain("hreflang={definition.hreflang}");
  });

  it("aria-labelをlocale別辞書(dictionary.languageSwitcher.label)から取得する", () => {
    expect(source).toContain("dictionary.languageSwitcher.label");
  });

  it("リンク先はbuildLocalizedPagePath(同じpageKeyの別locale版)を使う(未知パスの相互変換をしない設計と対比)", () => {
    expect(source).toContain("buildLocalizedPagePath(definition.key, pageKey)");
  });
});

describe("SiteNav.astro — currentKeyをpropsとして受け取り、URLから再解決しない", () => {
  const source = readSrc("src/components/SiteNav.astro");

  it("currentKey propを受け取り、目的別メニュー内の現在地表示に使う", () => {
    expect(source).toMatch(/currentKey\?:\s*ToolPageKey/);
    expect(source).toContain("link.page === currentKey");
    expect(source).toContain('aria-current={currentKey === link.page ? "page" : undefined}');
  });

  it("トップページと同じpurposeGroupsを使い、locale別URLを組み立てる", () => {
    expect(source).toContain("getPageContent(locale).home.purposeGroups");
    expect(source).toContain("buildLocalizedPagePath(locale, link.page)");
  });

  it("details/summaryでツールメニューを開閉できる", () => {
    expect(source).toContain('<details class:list={["site-nav__menu"');
    expect(source).toContain('<summary class="site-nav__trigger">');
  });

  it("信頼ページを静的HTMLのまま保つため、クライアントスクリプトを追加しない", () => {
    expect(source).not.toMatch(/<script[^>]*>/);
  });

  it("Astro.url.pathnameを直接参照しない(現在地解決をlayoutからのpropsに一元化)", () => {
    expect(source).not.toContain("Astro.url.pathname");
  });
});

describe("SiteFooter.astro — locale別/licensesリンク・client JSなし", () => {
  const source = readSrc("src/components/SiteFooter.astro");

  it('buildLocalizedPagePath(locale, "licenses")でhrefを組み立てる', () => {
    expect(source).toContain('buildLocalizedPagePath(locale, "licenses")');
  });

  it("<script>タグ・client:loadを持たない", () => {
    expect(source).not.toMatch(/<script[^>]*>/);
    expect(source).not.toContain("client:load");
  });
});

describe("Workerにはlocaleが渡されていない", () => {
  const workerFiles = [
    "src/components/image-intake/heic-convert.worker.ts",
    "src/components/image-intake/image-compress.worker.ts",
    "src/components/image-intake/png-to-webp.worker.ts",
    "src/components/image-intake/raster-convert.worker.ts",
    "src/components/image-intake/remove-exif.worker.ts",
    "src/components/image-intake/target-fit.worker.ts",
    "src/components/png-compression/png-compression.worker.ts",
  ];

  it.each(workerFiles)("%s はlocaleという識別子を含まない", (relPath) => {
    if (!existsSync(path.join(root, relPath))) return;
    const source = readSrc(relPath);
    expect(source).not.toMatch(/\blocale\b/);
  });
});
