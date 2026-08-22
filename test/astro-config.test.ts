import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// astro.config.mjsを直接importするとAstro/Viteの内部初期化が絡み重くなるため、
// 既存の404/licensesページのテストと同様にソーステキストを対象とした検証にする
// (実際の設定が反映されていることは、他のテストでのビルド成果物検証・vitestの
// build系テストで別途担保する)。
const configSource = readFileSync(path.join(process.cwd(), "astro.config.mjs"), "utf-8");

describe("astro.config.mjs — i18n routing", () => {
  it("defaultLocaleがenである", () => {
    expect(configSource).toMatch(/defaultLocale:\s*"en"/);
  });

  it("localesがen・jaのみ(reserved localeを含まない)", () => {
    const match = configSource.match(/locales:\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const localesList = match?.[1] ?? "";
    expect(localesList).toContain('"en"');
    expect(localesList).toContain('"ja"');
    for (const reserved of ["es", "pt-BR", "pt-br", "de", "fr"]) {
      expect(localesList).not.toContain(`"${reserved}"`);
    }
  });

  it("routing.prefixDefaultLocaleがfalseである(英語はprefix無し)", () => {
    expect(configSource).toMatch(/prefixDefaultLocale:\s*false/);
  });

  it('routing: "manual"を使用していない', () => {
    expect(configSource).not.toMatch(/routing:\s*"manual"/);
  });

  it("fallbackを設定していない", () => {
    expect(configSource).not.toMatch(/\bfallback\s*:/);
  });

  it("redirectToDefaultLocaleを設定キーとして使用していない", () => {
    // 説明コメント中に"redirectToDefaultLocale"という語自体が出てくることはあるため、
    // 実際にconfigのキーとして使われているか(コロンを伴う代入)だけを判定する。
    expect(configSource).not.toMatch(/redirectToDefaultLocale\s*:/);
  });

  it('trailingSlashが"always"である', () => {
    expect(configSource).toMatch(/trailingSlash:\s*"always"/);
  });

  it("siteが新本番origin(https://limifile.com)に更新されている", () => {
    expect(configSource).toMatch(/site:\s*"https:\/\/limifile\.com"/);
  });
});
