#!/usr/bin/env node
/**
 * ビルド成果物(dist/)を対象に、PR #18(信頼ページ追加)の6ページ
 * (privacy/terms/contact × en/ja)を検証するスクリプト。
 *
 * 検証対象:
 * - ファイル存在・locale別lang・title・description・h1・noindex,nofollow
 * - canonical・og:url・og:locale・en/ja hreflang・x-default
 * - クライアントJSなし(astro-island・<script>なし)
 * - footer 4リンク(licenses/privacy/terms/contact)・LanguageSwitcher
 * - 公開問い合わせ先(bunmeiproducts@gmail.com)・mailtoリンク
 * - effective date表示
 * - privacy: ブラウザ内処理・server upload未実装・hosting data慎重な説明・
 *   analytics/cookie記述・外部リンク説明・policy update説明
 * - terms: 利用者責任・バックアップ/結果確認・機能制約・指定容量保証なし・
 *   責任制限(適用法令の範囲)・OSSライセンスリンク・架空の運営者情報が無いこと
 * - contact: メール・画像添付NG案内・不具合報告に役立つ情報・返信保証なし・
 *   contact formや外部form endpointが無いこと
 * - 禁止表現(過剰な断定・保証)ガード
 *
 * 使い方: node scripts/verify-trust-pages.mjs
 * (事前に `npm run build` を実行しておくことを推奨。未実行の場合はこのスクリプトが実行する)
 */
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(rootDir, "dist");
const origin = "https://limifile.com";
const CONTACT_EMAIL = "bunmeiproducts@gmail.com";
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

let failures = 0;
function check(label, condition, detail = "") {
  const mark = condition ? "OK  " : "FAIL";
  console.log(`[${mark}] ${label}${detail ? " — " + detail : ""}`);
  if (!condition) failures += 1;
}

if (!existsSync(distDir)) {
  console.log("dist/ が無いためビルドします: npm run build");
  execSync("npm run build", { cwd: rootDir, stdio: "inherit" });
}

function readDistHtml(distRel) {
  const filePath = path.join(distDir, distRel);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

function extractAttr(html, tagPattern) {
  const match = html.match(tagPattern);
  return match ? match[1] : null;
}

const PAGES = [
  {
    key: "privacy",
    en: "privacy/index.html",
    ja: "ja/privacy/index.html",
    enUrl: "/privacy/",
    jaUrl: "/ja/privacy/",
  },
  {
    key: "terms",
    en: "terms/index.html",
    ja: "ja/terms/index.html",
    enUrl: "/terms/",
    jaUrl: "/ja/terms/",
  },
  {
    key: "contact",
    en: "contact/index.html",
    ja: "ja/contact/index.html",
    enUrl: "/contact/",
    jaUrl: "/ja/contact/",
  },
];

// --- 共通のfile存在・SEO基盤チェック(en/ja各ページ) ---
for (const page of PAGES) {
  for (const [locale, distRel, url, htmlLang, ogLocale] of [
    ["en", page.en, page.enUrl, "en", "en_US"],
    ["ja", page.ja, page.jaUrl, "ja", "ja_JP"],
  ]) {
    const html = readDistHtml(distRel);
    if (html === null) {
      check(`dist/${distRel} が存在する`, false);
      continue;
    }
    check(
      `${url}: <html lang="${htmlLang}">`,
      new RegExp(`<html\\s+lang="${htmlLang}"`).test(html),
    );
    check(`${url}: <title>が存在する`, /<title>[^<]+<\/title>/.test(html));
    check(
      `${url}: meta descriptionが存在する`,
      /<meta\s+name="description"\s+content="[^"]+"/.test(html),
    );
    check(`${url}: h1が1つだけ存在する`, (html.match(/<h1[^>]*>/g) ?? []).length === 1);
    check(`${url}: noindex, nofollow`, html.includes('content="noindex, nofollow"'));

    const canonicalMatches = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]*)"/g)];
    check(`${url}: canonicalが1つだけ存在する`, canonicalMatches.length === 1);
    const expectedCanonical = `${origin}${url}`;
    check(
      `${url}: canonicalが自己参照(${expectedCanonical})`,
      canonicalMatches[0]?.[1] === expectedCanonical,
      `実際: ${canonicalMatches[0]?.[1]}`,
    );

    const ogUrl = extractAttr(html, /<meta\s+property="og:url"\s+content="([^"]*)"/);
    check(`${url}: og:urlがcanonicalと一致`, ogUrl === expectedCanonical, `実際: ${ogUrl}`);
    const ogLocaleActual = extractAttr(html, /<meta\s+property="og:locale"\s+content="([^"]*)"/);
    check(`${url}: og:localeが${ogLocale}`, ogLocaleActual === ogLocale, `実際: ${ogLocaleActual}`);

    const hreflangMatches = [
      ...html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]*)"\s+href="([^"]*)"/g),
    ].filter((m) => m[1] !== "x-default");
    check(`${url}: hreflangがen・ja各1件ずつ`, hreflangMatches.length === 2);
    const expectedEnUrl = `${origin}${page.enUrl}`;
    const expectedJaUrl = `${origin}${page.jaUrl}`;
    check(
      `${url}: hreflang enが${expectedEnUrl}`,
      hreflangMatches.find((m) => m[1] === "en")?.[2] === expectedEnUrl,
    );
    check(
      `${url}: hreflang jaが${expectedJaUrl}`,
      hreflangMatches.find((m) => m[1] === "ja")?.[2] === expectedJaUrl,
    );
    const xDefault = extractAttr(
      html,
      /<link\s+rel="alternate"\s+hreflang="x-default"\s+href="([^"]*)"/,
    );
    check(`${url}: x-defaultが英語版(${expectedEnUrl})`, xDefault === expectedEnUrl);

    check(`${url}: astro-islandが存在しない`, !html.includes("astro-island"));
    check(`${url}: <script>タグが存在しない`, !/<script[^>]*>/.test(html));

    // footer 4リンク(licenses/privacy/terms/contact)
    const footerLocalePrefix = locale === "ja" ? "/ja" : "";
    for (const footerKey of ["licenses", "privacy", "terms", "contact"]) {
      check(
        `${url}: footerに${footerLocalePrefix}/${footerKey}/へのリンクがある`,
        html.includes(`href="${footerLocalePrefix}/${footerKey}/"`),
      );
    }

    // LanguageSwitcher(相互リンク)
    check(
      `${url}: LanguageSwitcherが英語版へのリンクを持つ`,
      html.includes(`href="${page.enUrl}"`),
    );
    check(
      `${url}: LanguageSwitcherが日本語版へのリンクを持つ`,
      html.includes(`href="${page.jaUrl}"`),
    );

    // 公開問い合わせ先・mailtoリンク
    check(`${url}: 公開メールアドレス(${CONTACT_EMAIL})を含む`, html.includes(CONTACT_EMAIL));
    check(`${url}: mailtoリンクを含む`, html.includes(`href="${CONTACT_MAILTO}"`));

    // effective date。ページごとに独立した日付を持ち、実質的な内容変更があったページだけが動く。
    // contactページはeffective dateを表示しない(ContactPage.astroが描画していない)ため、
    // 「描画されていないこと」と「他ページの日付が紛れ込んでいないこと」を代わりに検証する。
    const EFFECTIVE_DATES = {
      privacy: { en: "August 20, 2026", ja: "2026年8月20日" },
      terms: { en: "August 21, 2026", ja: "2026年8月21日" },
      contact: { en: "August 18, 2026", ja: "2026年8月18日" },
    };
    if (page.key === "contact") {
      check(
        `${url}: effective dateを表示しない(contactのみ非表示。日付はデータとしてのみ保持)`,
        !html.includes('class="trust-effective-date"'),
      );
      for (const otherKey of ["privacy", "terms"]) {
        const otherDate = EFFECTIVE_DATES[otherKey][locale];
        check(
          `${url}: 他ページのeffective date(${otherKey}: ${otherDate})が紛れ込んでいない`,
          !html.includes(otherDate),
        );
      }
    } else {
      const dateMarker = EFFECTIVE_DATES[page.key][locale];
      check(`${url}: effective date(${dateMarker})を含む`, html.includes(dateMarker));
      // termsとprivacyが同じ日付を共有していないこと(共有すると片方の変更で両方が動く)
      const otherKey = page.key === "privacy" ? "terms" : "privacy";
      check(
        `${url}: ${otherKey}のeffective date(${EFFECTIVE_DATES[otherKey][locale]})を含まない`,
        !html.includes(EFFECTIVE_DATES[otherKey][locale]),
      );
    }
  }
}

// --- privacy固有の内容チェック ---
const privacyEn = readDistHtml("privacy/index.html");
const privacyJa = readDistHtml("ja/privacy/index.html");
if (privacyEn && privacyJa) {
  check(
    "privacy(en): ブラウザ内処理の説明を含む",
    /inside your browser|on your device/.test(privacyEn),
  );
  check(
    "privacy(en): server uploadを実装していない旨の説明を含む",
    /not designed to upload|does not currently implement/.test(privacyEn),
  );
  check(
    "privacy(en): hosting request dataへの慎重な説明を含む(may process)",
    /may process/.test(privacyEn),
  );
  check(
    "privacy(en): analyticsでcookieを使用しない旨を含む",
    /does not use cookies/.test(privacyEn),
  );
  check(
    "privacy(en): Umami Cloudと4イベントの説明を含む",
    /Umami Cloud/.test(privacyEn) && /processing started/.test(privacyEn),
  );
  check(
    "privacy(en): Umami標準メタデータと匿名sessionの説明を含む",
    /connecting IP address/.test(privacyEn) &&
      /anonymous session/.test(privacyEn) &&
      /screen size/.test(privacyEn) &&
      /approximate country, region, and city/.test(privacyEn) &&
      /does not set a Umami Distinct ID/.test(privacyEn),
  );
  check(
    "privacy(en): Umamiへ画像・ファイル名等を送らない説明を含む",
    /does not receive your selected images/.test(privacyEn) && /file names/.test(privacyEn),
  );
  check("privacy(en): 外部リンクの説明を含む", /external websites/.test(privacyEn));
  check("privacy(en): policy updateの説明を含む", /update this policy/.test(privacyEn));

  check("privacy(ja): ブラウザ内処理の説明を含む", privacyJa.includes("ブラウザ内"));
  check(
    "privacy(ja): server uploadを実装していない旨の説明を含む",
    privacyJa.includes("設計されていません") || privacyJa.includes("実装していません"),
  );
  check("privacy(ja): hostingデータへの慎重な説明を含む", privacyJa.includes("場合があります"));
  check(
    "privacy(ja): アクセス解析でcookieを使用しない旨を含む",
    privacyJa.includes("使用していません"),
  );
  check(
    "privacy(ja): Umami Cloudと4イベントの説明を含む",
    privacyJa.includes("Umami Cloud") && privacyJa.includes("処理開始・処理成功・処理失敗"),
  );
  check(
    "privacy(ja): Umami標準メタデータと匿名sessionの説明を含む",
    privacyJa.includes("接続元IPアドレス") &&
      privacyJa.includes("匿名セッション") &&
      privacyJa.includes("画面サイズ") &&
      privacyJa.includes("国・地域・都市") &&
      privacyJa.includes("Distinct ID"),
  );
  check(
    "privacy(ja): Umamiへ画像・ファイル名等を送らない説明を含む",
    privacyJa.includes("Umamiへ、選択画像") && privacyJa.includes("ファイル名"),
  );
  check("privacy(ja): 外部リンクの説明を含む", privacyJa.includes("外部サイト"));
  check("privacy(ja): policy updateの説明を含む", privacyJa.includes("更新する場合があります"));
}

// --- terms固有の内容チェック ---
const termsEn = readDistHtml("terms/index.html");
const termsJa = readDistHtml("ja/terms/index.html");
if (termsEn && termsJa) {
  check("terms(en): 利用者の責任(rights/permissions)説明を含む", /necessary rights/.test(termsEn));
  check("terms(en): バックアップ/結果確認の説明を含む", /[Kk]eep a backup/.test(termsEn));
  check(
    "terms(en): 指定容量への到達を保証しない旨を含む",
    /does not guarantee that output will always reach/.test(termsEn),
  );
  check(
    "terms(en): 責任制限が適用法令の範囲で限定されている(無限定の免責でない)",
    /to the extent permitted by applicable law/i.test(termsEn),
  );
  check(
    "terms(en): 故意・重過失を排除する意図がない旨を含む",
    /intentional misconduct|gross negligence/.test(termsEn),
  );
  check("terms(en): OSSライセンス一覧へのリンクを含む", /href="\/licenses\/"/.test(termsEn));
  check(
    "terms(en): 架空の運営会社名・住所・電話番号・裁判管轄条項を含まない",
    !/Inc\.|Ltd\.|Co\.,|LLC|registered office|governing law|jurisdiction/i.test(termsEn),
  );
  check(
    "terms(en): 外部弁護士確認済み・法的有効性保証の表現を含まない",
    !/reviewed by legal counsel|legally guaranteed/i.test(termsEn),
  );

  check("terms(ja): 利用者の責任説明を含む", termsJa.includes("必要な権利・許可"));
  check("terms(ja): バックアップ/結果確認の説明を含む", termsJa.includes("バックアップ"));
  check(
    "terms(ja): 指定容量への到達を保証しない旨を含む",
    termsJa.includes("必ず到達することは保証しません"),
  );
  check(
    "terms(ja): 責任制限が適用法令の範囲で限定されている",
    termsJa.includes("適用法令で認められる範囲で"),
  );
  check("terms(ja): OSSライセンス一覧へのリンクを含む", /href="\/ja\/licenses\/"/.test(termsJa));
  check(
    "terms(ja): 架空の運営会社名・住所・電話番号・裁判管轄条項を含まない",
    !/株式会社|有限会社|所在地|管轄裁判所|電話番号/.test(termsJa),
  );
  check("terms(ja): 弁護士確認済みの表現を含まない", !termsJa.includes("弁護士確認済み"));
}

// --- contact固有の内容チェック ---
const contactEn = readDistHtml("contact/index.html");
const contactJa = readDistHtml("ja/contact/index.html");
if (contactEn && contactJa) {
  check(
    "contact(en): 個人情報・機密情報を含む画像を添付しない旨を含む",
    /personal or confidential information/.test(contactEn),
  );
  check(
    "contact(en): 不具合報告に役立つ情報(browser/OS/steps/error)を含む",
    /browser name and version/.test(contactEn) &&
      /OS and device/.test(contactEn) &&
      /steps you took/.test(contactEn) &&
      /error message/.test(contactEn),
  );
  check("contact(en): 返信を保証しない旨を含む", /reply is not guaranteed/.test(contactEn));
  check(
    "contact(en): <form>タグ(client formや外部form endpoint)が存在しない",
    !/<form[^>]*>/.test(contactEn),
  );

  check(
    "contact(ja): 個人情報・機密情報を含む画像を添付しない旨を含む",
    contactJa.includes("個人情報や機密情報を含む画像"),
  );
  check(
    "contact(ja): 不具合報告に役立つ情報(URL/ブラウザ/OS/手順/エラー)を含む",
    contactJa.includes("ブラウザ名・バージョン") &&
      contactJa.includes("OS・端末") &&
      contactJa.includes("操作手順") &&
      contactJa.includes("表示されたエラー文"),
  );
  check(
    "contact(ja): 返信を保証しない旨を含む",
    contactJa.includes("返信をお約束するものではありません"),
  );
  check(
    "contact(ja): <form>タグ(client formや外部form endpoint)が存在しない",
    !/<form[^>]*>/.test(contactJa),
  );
}

// --- 禁止表現guard(過剰な断定・保証を、文脈上正当な否定表現と区別する) ---
// 例: "does not guarantee" や "保証しません" のような否定文脈は許可し、
// "100%安全" のような肯定的な過剰断定のみを禁止対象とする。
const FORBIDDEN_JA = [
  "法的に完全",
  "完全に安全",
  "100%安全",
  "必ず削除",
  "すべての個人情報を削除",
  "弁護士確認済み",
];
const FORBIDDEN_EN = [
  "legally guaranteed",
  "100% secure",
  "completely safe",
  "removes all personal information",
  "reviewed by legal counsel",
];

const allTrustHtml = PAGES.flatMap((p) => [
  ["en", p.enUrl, readDistHtml(p.en)],
  ["ja", p.jaUrl, readDistHtml(p.ja)],
]).filter(([, , html]) => html !== null);

for (const [locale, url, html] of allTrustHtml) {
  const forbidden = locale === "en" ? FORBIDDEN_EN : FORBIDDEN_JA;
  for (const phrase of forbidden) {
    check(
      `${url}: 禁止表現「${phrase}」を含まない`,
      !html.toLowerCase().includes(phrase.toLowerCase()),
    );
  }
}

console.log(`\n合計失敗数: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
