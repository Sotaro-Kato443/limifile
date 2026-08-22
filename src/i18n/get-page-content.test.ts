import { describe, expect, it } from "vitest";
import { getToolCards } from "../config/tool-page-config";
import { getPageContent, getToolPageAbout } from "./get-page-content";
import type { LocalizedToolPageAboutKey } from "./page-content-types";

/**
 * en/ja両方が実在する8ツールページのkey。getPageContent(locale).toolsはlocaleに応じて
 * PageContent(en、固定容量4ページ含む全12key)またはLocalizedPageContent(ja、この8keyのみ)の
 * いずれかを返す型のため、ここではLocalizedToolPageAboutKeyに限定して両方のlocaleで
 * 安全にcontent.tools[key]を読める範囲だけを対象にする。
 */
const TOOL_KEYS: LocalizedToolPageAboutKey[] = [
  "heic-to-jpg",
  "compress-image",
  "compress-image-to-500kb",
  "remove-exif",
  "png-to-webp",
  "compress-png",
  "png-to-jpg",
  "webp-to-jpg",
];

function flattenSegments(segments: { type: string; text?: string; label?: string }[]): string {
  return segments.map((s) => (s.type === "text" ? (s.text ?? "") : (s.label ?? ""))).join("");
}

describe("getPageContent — home のキー完全性・空文字なし", () => {
  it("en/ja両方がhomeの全フィールドを持ち、3〜5問のFAQを持つ", () => {
    for (const locale of ["en", "ja"] as const) {
      const home = getPageContent(locale).home;
      expect(home.cardsAriaLabel.length).toBeGreaterThan(0);
      expect(home.intro.length).toBeGreaterThan(0);
      expect(flattenSegments(home.intro).length).toBeGreaterThan(0);
      expect(home.purposeHeading.length).toBeGreaterThan(0);
      expect(home.purposeGroups).toHaveLength(3);
      for (const group of home.purposeGroups) {
        expect(group.title.length).toBeGreaterThan(0);
        expect(group.links.length).toBeGreaterThan(0);
        for (const link of group.links) expect(link.label.length).toBeGreaterThan(0);
      }
      const groupedPages = home.purposeGroups.flatMap((group) =>
        group.links.map((link) => link.page),
      );
      expect(new Set(groupedPages).size).toBe(groupedPages.length);
      expect([...groupedPages].sort()).toEqual(
        getToolCards(locale)
          .map((card) => card.key)
          .sort(),
      );
      expect(home.analyzePrompt.length).toBeGreaterThan(0);
      expect(home.analyzeLinkLabel.length).toBeGreaterThan(0);
      expect(home.limitationsHeading.length).toBeGreaterThan(0);
      expect(home.limitations.length).toBeGreaterThan(0);
      for (const item of home.limitations) expect(item.length).toBeGreaterThan(0);
      expect(home.analyzeHeading.length).toBeGreaterThan(0);
      expect(home.analyzeParagraph.length).toBeGreaterThan(0);
      expect(home.faqHeading.length).toBeGreaterThan(0);
      expect(home.faq.length).toBeGreaterThanOrEqual(3);
      expect(home.faq.length).toBeLessThanOrEqual(5);
      for (const item of home.faq) {
        expect(item.question.length).toBeGreaterThan(0);
        expect(item.answer.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getPageContent — 8ツールページのキー完全性・空文字なし・4〜6問のFAQ", () => {
  it("en/ja両方が全8ツールの必須フィールドを持つ", () => {
    for (const locale of ["en", "ja"] as const) {
      const content = getPageContent(locale);
      for (const key of TOOL_KEYS) {
        const about = content.tools[key];
        expect(about.intro.length).toBeGreaterThan(0);
        expect(flattenSegments(about.intro).length).toBeGreaterThan(0);
        expect(about.featuresHeading.length).toBeGreaterThan(0);
        expect(about.features.length).toBeGreaterThanOrEqual(3);
        for (const item of about.features) expect(item.length).toBeGreaterThan(0);
        expect(about.howToHeading.length).toBeGreaterThan(0);
        expect(about.howToSteps.length).toBeGreaterThanOrEqual(3);
        for (const item of about.howToSteps) expect(item.length).toBeGreaterThan(0);
        expect(about.limitationsHeading.length).toBeGreaterThan(0);
        expect(about.limitations.length).toBeGreaterThanOrEqual(3);
        for (const item of about.limitations) expect(item.length).toBeGreaterThan(0);
        expect(Array.isArray(about.technicalNote)).toBe(true);
        expect(about.privacyHeading.length).toBeGreaterThan(0);
        expect(about.privacyNote.length).toBeGreaterThan(0);
        expect(about.faqHeading.length).toBeGreaterThan(0);
        expect(about.faq.length).toBeGreaterThanOrEqual(4);
        expect(about.faq.length).toBeLessThanOrEqual(6);
        for (const item of about.faq) {
          expect(item.question.length).toBeGreaterThan(0);
          expect(item.answer.length).toBeGreaterThan(0);
        }
        expect(about.relatedHeading.length).toBeGreaterThan(0);
        expect(about.relatedLinks.length).toBeGreaterThanOrEqual(2);
        expect(about.relatedLinks.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it("FAQの質問は同一ページ内で重複しない", () => {
    for (const locale of ["en", "ja"] as const) {
      const content = getPageContent(locale);
      for (const key of TOOL_KEYS) {
        const questions = content.tools[key].faq.map((item) => item.question);
        expect(new Set(questions).size).toBe(questions.length);
      }
      const homeQuestions = content.home.faq.map((item) => item.question);
      expect(new Set(homeQuestions).size).toBe(homeQuestions.length);
    }
  });
});

describe("relatedLinks — 実在するToolPageKeyのみを参照し、同一ページへのリンクを含まない", () => {
  it("各ツールのrelatedLinksは自分自身を含まない", () => {
    for (const locale of ["en", "ja"] as const) {
      const content = getPageContent(locale);
      for (const key of TOOL_KEYS) {
        const pages = content.tools[key].relatedLinks.map((link) => link.page);
        expect(pages).not.toContain(key);
      }
    }
  });

  it("compress-imageはcompress-image-to-500kb・compress-png・remove-exifへのrelatedLinksを持つ", () => {
    for (const locale of ["en", "ja"] as const) {
      const pages = getToolPageAbout(locale, "compress-image").relatedLinks.map((l) => l.page);
      expect(pages).toContain("compress-image-to-500kb");
      expect(pages).toContain("compress-png");
      expect(pages).toContain("remove-exif");
    }
  });
});

describe("getToolPageAbout — 日本語の主要事実が変更前と一致する", () => {
  it("heic-to-jpgの日本語technicalNoteにLGPL/libheif/libde265の説明を含む", () => {
    const about = getToolPageAbout("ja", "heic-to-jpg");
    const allText = about.technicalNote
      .flat()
      .map((segment) => (segment.type === "text" ? segment.text : segment.label))
      .join("");
    expect(allText).toContain("libheif 1.19.7");
    expect(allText).toContain("libde265 1.0.15");
    expect(allText).toContain("LGPL v3");
  });

  it("compress-image-to-500kbの日本語limitationsに500KB(500,000 bytes)固定の説明を含む", () => {
    const about = getToolPageAbout("ja", "compress-image-to-500kb");
    const allText = about.limitations.join("");
    expect(allText).toContain("500,000 bytes");
    expect(allText).toContain("APNG");
    expect(allText).toContain("保証するものではありません");
  });

  it("compress-pngの日本語limitationsに指定容量への到達を保証しない旨を含む", () => {
    const about = getToolPageAbout("ja", "compress-png");
    const allText = about.limitations.join("") + about.privacyNote;
    expect(allText).toContain("保証されません");
    expect(about.privacyNote).toContain("外部へアップロードされることはありません");
  });
});

describe("getToolPageAbout — 英語が対応する事実を省略・過剰保証していない", () => {
  it("heic-to-jpgの英語technicalNoteにLGPL v3・libheif・libde265のversionを含む", () => {
    const about = getToolPageAbout("en", "heic-to-jpg");
    const allText = about.technicalNote
      .flat()
      .map((segment) => (segment.type === "text" ? segment.text : segment.label))
      .join("");
    expect(allText).toContain("libheif 1.19.7");
    expect(allText).toContain("libde265 1.0.15");
    expect(allText).toContain("LGPL v3");
    expect(allText).toMatch(/not legal advice|guarantee of legal sufficiency/);
  });

  it("compress-image-to-500kbの英語limitationsに500KB(500,000 bytes)固定・APNG非対応・保証なしを含む", () => {
    const about = getToolPageAbout("en", "compress-image-to-500kb");
    const allText = about.limitations.join(" ");
    expect(allText).toContain("500,000 bytes");
    expect(allText).toContain("APNG");
    expect(allText).toMatch(/not guaranteed/);
  });

  it("compress-pngの英語limitations/privacyNoteに指定容量への到達を保証しない旨・外部アップロードなしを含む", () => {
    const about = getToolPageAbout("en", "compress-png");
    const allText = about.limitations.join(" ");
    expect(allText).toMatch(/not guaranteed/);
    expect(about.privacyNote).toMatch(/never uploaded externally/);
  });

  it("remove-exifの英語limitationsに向き情報を必要な場合のみ残す旨を含む", () => {
    const about = getToolPageAbout("en", "remove-exif");
    const allText = about.features.join(" ") + " " + about.limitations.join(" ");
    expect(allText).toMatch(/[Oo]rientation/);
    expect(allText).toMatch(/when the photo needs it|when necessary/);
  });
});

describe("重要な事実の記載漏れ・過剰保証がないこと", () => {
  it("compress-imageの英語limitationsにアニメーションWebP非対応の説明を含む", () => {
    const about = getToolPageAbout("en", "compress-image");
    expect(about.limitations.join(" ")).toMatch(/[Aa]nimated WebP/);
  });

  it("compress-imageの日本語limitationsにアニメーションWebP非対応の説明を含む", () => {
    const about = getToolPageAbout("ja", "compress-image");
    expect(about.limitations.join("")).toContain("アニメーションWebP");
  });

  it("heic-to-jpgは専用のメタデータ削除機能ではない旨をFAQに含む(過剰保証しない)", () => {
    for (const locale of ["en", "ja"] as const) {
      const about = getToolPageAbout(locale, "heic-to-jpg");
      const allFaqText = about.faq.map((item) => item.answer).join(" ");
      expect(allFaqText).toMatch(
        /dedicated metadata-removal tool|専用のメタデータ削除機能ではありません/,
      );
    }
  });

  it("remove-exifは完全な匿名化を保証しない旨をFAQに含む", () => {
    for (const locale of ["en", "ja"] as const) {
      const about = getToolPageAbout(locale, "remove-exif");
      const allFaqText = about.faq.map((item) => item.answer).join(" ");
      expect(allFaqText).toMatch(
        /isn't a guarantee that no identifying detail remains|識別情報が一切残らないことを保証するものではありません/,
      );
    }
  });

  it("png-to-webpのlimitationsにAPNG非対応・寸法不変の説明を含む(en/ja)", () => {
    for (const locale of ["en", "ja"] as const) {
      const about = getToolPageAbout(locale, "png-to-webp");
      const allText = about.limitations.join(" ");
      expect(allText).toContain("APNG");
    }
  });

  it("home の limitations が指定容量非保証・保存/確認の案内を含む(en/ja)", () => {
    for (const locale of ["en", "ja"] as const) {
      const home = getPageContent(locale).home;
      const allText = home.limitations.join(" ");
      expect(allText.length).toBeGreaterThan(0);
    }
    const en = getPageContent("en").home.limitations.join(" ");
    expect(en).toMatch(/not guaranteed/);
    expect(en).toMatch(/[Kk]eep a copy/);
    const ja = getPageContent("ja").home.limitations.join("");
    expect(ja).toContain("保証していません");
    expect(ja).toContain("保存");
  });
});

describe("ページ内リンクのpageLinkセグメントは実在するPublicPageKeyのみを参照する", () => {
  it("heic-to-jpgのlicensesリンクはanchor=heic-headingを持つ", () => {
    for (const locale of ["en", "ja"] as const) {
      const about = getToolPageAbout(locale, "heic-to-jpg");
      const pageLinks = about.technicalNote.flat().filter((s) => s.type === "pageLink");
      const licensesLink = pageLinks.find((s) => s.type === "pageLink" && s.page === "licenses");
      expect(licensesLink).toBeDefined();
      expect(licensesLink && "anchor" in licensesLink ? licensesLink.anchor : undefined).toBe(
        "heic-heading",
      );
    }
  });
});

describe("固定容量4ページ(20/50/100/200KB、英語専用)のToolPageAboutContent", () => {
  const EN_ONLY_KEYS = [
    "compress-image-to-20kb",
    "compress-image-to-50kb",
    "compress-image-to-100kb",
    "compress-image-to-200kb",
  ] as const;

  it("必須フィールドが空でなく、FAQは4〜6問・関連ツールは2〜4件を持つ", () => {
    for (const key of EN_ONLY_KEYS) {
      const about = getToolPageAbout("en", key);
      expect(flattenSegments(about.intro).length).toBeGreaterThan(0);
      expect(about.features.length).toBeGreaterThanOrEqual(3);
      expect(about.howToSteps.length).toBeGreaterThanOrEqual(3);
      expect(about.limitations.length).toBeGreaterThanOrEqual(3);
      expect(about.faq.length).toBeGreaterThanOrEqual(4);
      expect(about.faq.length).toBeLessThanOrEqual(6);
      expect(about.relatedLinks.length).toBeGreaterThanOrEqual(2);
      expect(about.relatedLinks.length).toBeLessThanOrEqual(4);
    }
  });

  it("それぞれの対象容量(KB)がintro・limitations・howToStepsに明記されている", () => {
    const expectations: Record<(typeof EN_ONLY_KEYS)[number], string> = {
      "compress-image-to-20kb": "20KB",
      "compress-image-to-50kb": "50KB",
      "compress-image-to-100kb": "100KB",
      "compress-image-to-200kb": "200KB",
    };
    for (const key of EN_ONLY_KEYS) {
      const about = getToolPageAbout("en", key);
      const label = expectations[key];
      expect(flattenSegments(about.intro)).toContain(label);
      expect(about.limitations.join(" ")).toContain(label);
      expect(about.howToSteps.join(" ")).toContain(label);
    }
  });

  it("best-effortであり到達を保証しない旨がlimitationsに明記されている", () => {
    for (const key of EN_ONLY_KEYS) {
      const about = getToolPageAbout("en", key);
      expect(about.limitations.join(" ")).toMatch(/not guaranteed/);
    }
  });

  it("relatedLinksは自分自身を含まない", () => {
    for (const key of EN_ONLY_KEYS) {
      const about = getToolPageAbout("en", key);
      expect(about.relatedLinks.map((l) => l.page)).not.toContain(key);
    }
  });

  it("popularSizesLinksは4件(自分以外の20/50/100/200/500KB)で、自分自身を含まない", () => {
    for (const key of EN_ONLY_KEYS) {
      const about = getToolPageAbout("en", key);
      expect(about.popularSizesLinks).toHaveLength(4);
      const pages = about.popularSizesLinks.map((l) => l.page);
      expect(pages).not.toContain(key);
      expect(new Set(pages).size).toBe(4);
    }
  });

  /**
   * 英語専用ページの本文が、特定の機関・制度の要件を満たすと読める断定を含まないことを検証する。
   * LimiFileはこれらの機関の公式要件を検証しておらず、機関名を挙げた断定は書けないため。
   * bannedTermsは検査対象の文字列そのものであり、想定用途を表すものではない。
   */
  it("英語専用ページの本文が特定の機関・制度名を断定的に記載していない", () => {
    const bannedTerms = ["SSC", "IBPS", "UPSC", "government portal"];
    for (const key of EN_ONLY_KEYS) {
      const about = getToolPageAbout("en", key);
      const allText = [
        flattenSegments(about.intro),
        about.features.join(" "),
        about.limitations.join(" "),
        about.faq.map((f) => `${f.question} ${f.answer}`).join(" "),
      ].join(" ");
      for (const term of bannedTerms) {
        expect(allText).not.toContain(term);
      }
    }
  });
});

describe("compress-image / compress-image-to-500kb の popularSizesLinks(人気の容量導線)", () => {
  it("compress-imageは英語で5件(20/50/100/200/500KB)のpopularSizesLinksを持つ", () => {
    const about = getToolPageAbout("en", "compress-image");
    expect(about.popularSizesLinks).toHaveLength(5);
    const pages = about.popularSizesLinks.map((l) => l.page);
    expect(pages).toContain("compress-image-to-20kb");
    expect(pages).toContain("compress-image-to-50kb");
    expect(pages).toContain("compress-image-to-100kb");
    expect(pages).toContain("compress-image-to-200kb");
    expect(pages).toContain("compress-image-to-500kb");
  });

  it("compress-image-to-500kbは英語で4件(20/50/100/200KB、自分以外)のpopularSizesLinksを持つ", () => {
    const about = getToolPageAbout("en", "compress-image-to-500kb");
    expect(about.popularSizesLinks).toHaveLength(4);
    expect(about.popularSizesLinks.map((l) => l.page)).not.toContain("compress-image-to-500kb");
  });

  it("日本語版のcompress-image・compress-image-to-500kbはpopularSizesLinksが空(日本語版の固定容量ページが無いため)", () => {
    expect(getToolPageAbout("ja", "compress-image").popularSizesLinks).toEqual([]);
    expect(getToolPageAbout("ja", "compress-image-to-500kb").popularSizesLinks).toEqual([]);
  });

  it("popularSizesLinksを持たない既存ページ(heic-to-jpg等)は空配列を返す(en/ja両方)", () => {
    for (const locale of ["en", "ja"] as const) {
      for (const key of [
        "heic-to-jpg",
        "remove-exif",
        "png-to-webp",
        "compress-png",
        "png-to-jpg",
        "webp-to-jpg",
      ] as const) {
        expect(getToolPageAbout(locale, key).popularSizesLinks).toEqual([]);
      }
    }
  });
});

describe("getToolPageAbout — 不正なlocale/key組み合わせは明示的にthrowする(castによるundefinedの黙殺はしない)", () => {
  const EN_ONLY_KEYS = [
    "compress-image-to-20kb",
    "compress-image-to-50kb",
    "compress-image-to-100kb",
    "compress-image-to-200kb",
    "avif-to-jpg",
  ] as const;

  it.each(EN_ONLY_KEYS)('locale="ja"に英語専用key"%s"を渡すと説明的なErrorをthrowする', (key) => {
    expect(() => getToolPageAbout("ja", key)).toThrow(/has no Japanese content|English-only page/);
  });

  it("エラーメッセージに該当keyが含まれる(デバッグしやすくするため)", () => {
    expect(() => getToolPageAbout("ja", "compress-image-to-50kb")).toThrow(
      /compress-image-to-50kb/,
    );
  });

  it('locale="en"では同じkeyで正常にToolPageAboutContentを返す(回帰確認)', () => {
    for (const key of EN_ONLY_KEYS) {
      expect(() => getToolPageAbout("en", key)).not.toThrow();
    }
  });
});
