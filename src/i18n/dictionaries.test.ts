import { describe, expect, it } from "vitest";
import { en } from "./dictionaries/en";
import { ja } from "./dictionaries/ja";

/**
 * 辞書がCommonDictionaryを満たすことはTypeScriptの型チェック(typecheck)でも強制されるが、
 * 実行時にも二重に検証する(意図しない`as`キャスト等で型チェックを回避された場合の保険)。
 */
function collectKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("CommonDictionary: en/ja", () => {
  it("キー構造が完全に一致する", () => {
    const enKeys = collectKeyPaths(en).sort();
    const jaKeys = collectKeyPaths(ja).sort();
    expect(enKeys).toEqual(jaKeys);
  });

  it.each([
    ["en", en],
    ["ja", ja],
  ])("%sのすべての文言が空文字でない", (_label, dictionary) => {
    for (const value of collectKeyPaths(dictionary).map((path) => getByPath(dictionary, path))) {
      // テンプレート文言(ファイル名・数値等を埋め込む関数値)は存在確認のみ行う。
      // 実際の出力内容はコンポーネントテスト側で個別に検証している。
      if (typeof value === "function") continue;
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it("privacyNotice(画像を外部サーバーへ送信しない旨の説明)がen/ja両方に存在する", () => {
    expect(en.privacyNotice.length).toBeGreaterThan(0);
    expect(ja.privacyNotice.length).toBeGreaterThan(0);
  });

  it("ja.notFoundの各文言は既存404ページと同じ表記を保つ", () => {
    expect(ja.notFound.heading).toBe("ページが見つかりません");
    expect(ja.backToHome).toBe("トップページへ戻る");
  });
});

function getByPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, value);
}
