import { describe, expect, it } from "vitest";
import {
  ACTIVE_LOCALES,
  DEFAULT_LOCALE,
  LOCALES,
  RESERVED_LOCALES,
  getLocaleDefinition,
  isActiveLocaleKey,
  type LocaleKey,
} from "./locales";

describe("LOCALES", () => {
  it("enとjaを含む", () => {
    const keys = LOCALES.map((locale) => locale.key);
    expect(keys).toContain("en");
    expect(keys).toContain("ja");
  });

  it("既定言語はenのみ", () => {
    const defaults = LOCALES.filter((locale) => locale.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].key).toBe("en");
    expect(DEFAULT_LOCALE.key).toBe("en");
  });

  it("既定言語(en)はURL prefixが空文字", () => {
    expect(DEFAULT_LOCALE.urlCode).toBe("");
  });

  it("pt-BRはURLコード(pt-br)とHTML lang(pt-BR)が異なる表記として区別される", () => {
    const ptBr = getLocaleDefinition("pt-BR");
    expect(ptBr.urlCode).toBe("pt-br");
    expect(ptBr.htmlLang).toBe("pt-BR");
    expect(ptBr.urlCode).not.toBe(ptBr.htmlLang);
  });

  it("現時点で有効なロケールはen・jaのみ", () => {
    const activeKeys = ACTIVE_LOCALES.map((locale) => locale.key).sort();
    expect(activeKeys).toEqual(["en", "ja"]);
  });

  it("reserved locale(es・pt-BR・de・fr)はisEnabled=false", () => {
    expect(RESERVED_LOCALES.length).toBeGreaterThan(0);
    for (const locale of RESERVED_LOCALES) {
      expect(locale.isEnabled).toBe(false);
      expect(locale.isReserved).toBe(true);
    }
    const reservedKeys = RESERVED_LOCALES.map((locale) => locale.key).sort();
    expect(reservedKeys).toEqual(["de", "es", "fr", "pt-BR"]);
  });

  it("有効ロケールとreserved localeに重複が無い", () => {
    const activeKeys = new Set(ACTIVE_LOCALES.map((locale) => locale.key));
    for (const locale of RESERVED_LOCALES) {
      expect(activeKeys.has(locale.key)).toBe(false);
    }
  });

  it("全ロケールでURLコードが重複しない(既定言語の空文字を除く)", () => {
    const nonEmptyUrlCodes = LOCALES.map((locale) => locale.urlCode).filter((code) => code !== "");
    expect(new Set(nonEmptyUrlCodes).size).toBe(nonEmptyUrlCodes.length);
  });

  it("全ロケールでhtmlLangが空文字でない", () => {
    for (const locale of LOCALES) {
      expect(locale.htmlLang.length).toBeGreaterThan(0);
    }
  });
});

describe("getLocaleDefinition", () => {
  it("既知のlocale keyは対応する定義を返す", () => {
    expect(getLocaleDefinition("ja").ogLocale).toBe("ja_JP");
  });

  it("未知のlocale keyは例外を投げる(黙って既定言語へfallbackしない)", () => {
    expect(() => getLocaleDefinition("xx" as LocaleKey)).toThrow(/Unknown locale key/);
  });
});

describe("isActiveLocaleKey", () => {
  it("en・jaはtrue", () => {
    expect(isActiveLocaleKey("en")).toBe(true);
    expect(isActiveLocaleKey("ja")).toBe(true);
  });

  it("reserved locale(pt-BR等)はfalse", () => {
    expect(isActiveLocaleKey("pt-BR")).toBe(false);
    expect(isActiveLocaleKey("es")).toBe(false);
  });

  it("完全に未知の文字列はfalse", () => {
    expect(isActiveLocaleKey("xx")).toBe(false);
    expect(isActiveLocaleKey("")).toBe(false);
  });
});
