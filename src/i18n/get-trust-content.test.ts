import { describe, expect, it } from "vitest";
import { getTrustContent, getTrustPageContent } from "./get-trust-content";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "./trust-content-types";
import type { TrustPageKey } from "./trust-content-types";

const KEYS: TrustPageKey[] = ["privacy", "terms", "contact"];

describe("CONTACT_EMAIL / CONTACT_MAILTO", () => {
  it("公開問い合わせ先はbunmeiproducts@gmail.comで、mailtoが対応するmailtoリンクになっている", () => {
    expect(CONTACT_EMAIL).toBe("bunmeiproducts@gmail.com");
    expect(CONTACT_MAILTO).toBe(`mailto:${CONTACT_EMAIL}`);
  });
});

describe("getTrustContent — en/jaのキー完全性・空文字なし", () => {
  it("en/ja両方が全3ページ(privacy/terms/contact)のcontentを持つ", () => {
    for (const locale of ["en", "ja"] as const) {
      const content = getTrustContent(locale);
      for (const key of KEYS) {
        const page = content[key];
        expect(page.title.length).toBeGreaterThan(0);
        expect(page.description.length).toBeGreaterThan(0);
        expect(page.heading.length).toBeGreaterThan(0);
        expect(page.effectiveDateLabel.length).toBeGreaterThan(0);
        expect(page.sections.length).toBeGreaterThan(0);
        for (const section of page.sections) {
          expect(section.heading.length).toBeGreaterThan(0);
          const hasParagraphs = section.paragraphs.length > 0;
          const hasListItems = (section.listItems?.length ?? 0) > 0;
          expect(hasParagraphs || hasListItems).toBe(true);
        }
      }
    }
  });

  it("privacyの最終更新日はUmami計測方針を反映した2026年8月20日", () => {
    const en = getTrustPageContent("en", "privacy").effectiveDateLabel;
    const ja = getTrustPageContent("ja", "privacy").effectiveDateLabel;
    expect(en).toContain("August 20, 2026");
    expect(ja).toContain("2026年8月20日");
  });

  it("termsの最終更新日はApache-2.0公開に伴う第8条の変更を反映した2026年8月21日", () => {
    const en = getTrustPageContent("en", "terms").effectiveDateLabel;
    const ja = getTrustPageContent("ja", "terms").effectiveDateLabel;
    expect(en).toContain("August 21, 2026");
    expect(ja).toContain("2026年8月21日");
  });

  it("contactは内容を変更していないため2026年8月18日を維持する", () => {
    const en = getTrustPageContent("en", "contact").effectiveDateLabel;
    const ja = getTrustPageContent("ja", "contact").effectiveDateLabel;
    expect(en).toContain("August 18, 2026");
    expect(ja).toContain("2026年8月18日");
  });

  /**
   * 3ページは以前termsとcontactで同一の定数を共有しており、termsだけを変更したときに
   * contactの日付まで動いてしまった。ページごとに独立した定数を持つことを、値が
   * 互いに異なることで明示的に検証する(共有へ戻したらここで落ちる)。
   */
  it("privacy・terms・contactの最終更新日は互いに独立している", () => {
    for (const locale of ["en", "ja"] as const) {
      const privacy = getTrustPageContent(locale, "privacy").effectiveDateLabel;
      const terms = getTrustPageContent(locale, "terms").effectiveDateLabel;
      const contact = getTrustPageContent(locale, "contact").effectiveDateLabel;
      expect(new Set([privacy, terms, contact]).size).toBe(3);
    }
  });
});

describe("privacyの重要な説明が含まれる", () => {
  it("en: ブラウザ内処理・server未実装・cookieなしのanalytics・外部リンク・変更の説明を含む", () => {
    const sections = getTrustPageContent("en", "privacy").sections;
    const allText = sections
      .flatMap((s) => s.paragraphs.flat())
      .map((seg) => (seg.type === "text" ? seg.text : seg.label))
      .join(" ");
    expect(allText).toMatch(/inside your browser/);
    expect(allText).toMatch(/not designed to upload/);
    expect(allText).toMatch(/does not use cookies/);
    expect(allText).toMatch(/Umami Cloud/);
    expect(allText).toMatch(/processing started/);
    expect(allText).toMatch(/connecting IP address/);
    expect(allText).toMatch(/anonymous session/);
    expect(allText).toMatch(/screen size/);
    expect(allText).toMatch(/approximate country, region, and city/);
    expect(allText).toMatch(/does not set a Umami Distinct ID/);
    expect(allText).toMatch(/does not receive your selected images/);
    expect(allText).toMatch(/external websites/);
    expect(allText).toMatch(/update this policy/);
  });

  it("ja: ブラウザ内処理・server未実装・cookieなしのanalytics・外部リンク・変更の説明を含む", () => {
    const sections = getTrustPageContent("ja", "privacy").sections;
    const allText = sections
      .flatMap((s) => s.paragraphs.flat())
      .map((seg) => (seg.type === "text" ? seg.text : seg.label))
      .join(" ");
    expect(allText).toContain("ブラウザ内");
    expect(allText).toContain("設計されていません");
    expect(allText).toContain("使用していません");
    expect(allText).toContain("Umami Cloud");
    expect(allText).toContain("処理開始・処理成功・処理失敗");
    expect(allText).toContain("接続元IPアドレス");
    expect(allText).toContain("匿名セッション");
    expect(allText).toContain("画面サイズ");
    expect(allText).toContain("国・地域・都市");
    expect(allText).toContain("Distinct ID");
    expect(allText).toContain("選択画像");
    expect(allText).toContain("外部サイト");
  });
});

describe("termsの重要な説明が含まれる", () => {
  it("en: 利用者責任・禁止事項・機能制約・保証否認・責任制限・OSSリンクを含む", () => {
    const content = getTrustPageContent("en", "terms");
    const allText = content.sections
      .flatMap((s) => s.paragraphs.flat())
      .map((seg) => (seg.type === "text" ? seg.text : seg.label))
      .join(" ");
    expect(allText).toMatch(/necessary rights/);
    expect(allText).toMatch(/does not guarantee that output will always reach/);
    expect(allText).toMatch(/to the extent permitted by applicable law/i);
    const pageLinks = content.sections
      .flatMap((s) => s.paragraphs.flat())
      .filter((seg) => seg.type === "pageLink");
    expect(pageLinks.some((seg) => seg.type === "pageLink" && seg.page === "licenses")).toBe(true);

    const prohibited = content.sections.find((s) => s.listItems && s.listItems.length > 0);
    expect(prohibited?.listItems?.length).toBeGreaterThan(0);
  });

  it("ja: 利用者責任・禁止事項・機能制約・保証否認・責任制限・OSSリンクを含む", () => {
    const content = getTrustPageContent("ja", "terms");
    const allText = content.sections
      .flatMap((s) => s.paragraphs.flat())
      .map((seg) => (seg.type === "text" ? seg.text : seg.label))
      .join(" ");
    expect(allText).toContain("必要な権利・許可");
    expect(allText).toContain("保証しません");
    expect(allText).toContain("適用法令で認められる範囲で");
    const pageLinks = content.sections
      .flatMap((s) => s.paragraphs.flat())
      .filter((seg) => seg.type === "pageLink");
    expect(pageLinks.some((seg) => seg.type === "pageLink" && seg.page === "licenses")).toBe(true);
  });

  it("架空の会社名・住所・電話番号・裁判管轄条項を含まない(en/ja)", () => {
    for (const locale of ["en", "ja"] as const) {
      const content = getTrustPageContent(locale, "terms");
      const allText = JSON.stringify(content);
      expect(allText).not.toMatch(/Inc\.|Ltd\.|LLC|株式会社|有限会社|governing law|jurisdiction/i);
    }
  });
});

describe("contactの重要な説明が含まれる", () => {
  it("en: メール・添付禁止案内・役立つ情報・返信非保証を含む", () => {
    const content = getTrustPageContent("en", "contact");
    const allText = content.sections
      .flatMap((s) => s.paragraphs.flat())
      .map((seg) => (seg.type === "text" ? seg.text : seg.label))
      .join(" ");
    expect(allText).toContain(CONTACT_EMAIL);
    expect(allText).toMatch(/personal or confidential information/);
    const bugInfo = content.sections.find((s) => s.heading.includes("bug reports"));
    expect(bugInfo?.listItems).toEqual(
      expect.arrayContaining([expect.stringContaining("browser"), expect.stringContaining("OS")]),
    );
    const expectations = content.sections.find((s) => s.heading === "What to expect");
    expect(expectations?.listItems?.join(" ")).toMatch(/not guaranteed/);
  });

  it("ja: メール・添付禁止案内・役立つ情報・返信非保証を含む", () => {
    const content = getTrustPageContent("ja", "contact");
    const allText = content.sections
      .flatMap((s) => s.paragraphs.flat())
      .map((seg) => (seg.type === "text" ? seg.text : seg.label))
      .join(" ");
    expect(allText).toContain(CONTACT_EMAIL);
    expect(allText).toContain("個人情報や機密情報を含む画像");
    const bugInfo = content.sections.find((s) => s.heading.includes("役立つ情報"));
    expect(bugInfo?.listItems).toEqual(
      expect.arrayContaining([expect.stringContaining("ブラウザ"), expect.stringContaining("OS")]),
    );
  });

  it("contactページにはmailtoリンク(CONTACT_MAILTO)が含まれる(en/ja)", () => {
    for (const locale of ["en", "ja"] as const) {
      const content = getTrustPageContent(locale, "contact");
      const links = content.sections
        .flatMap((s) => s.paragraphs.flat())
        .filter((seg) => seg.type === "externalLink");
      expect(links.some((seg) => seg.type === "externalLink" && seg.href === CONTACT_MAILTO)).toBe(
        true,
      );
    }
  });
});
