# LimiFile Project Context

This file provides shared background for AI assistants and collaborators. It does not override the user's latest instructions, the current implementation, or live service state. Treat changing external information as historical unless it has been checked recently.

## Resolving conflicting information

Use this order:

1. The user's latest explicit request or correction
2. Current source code, tests, build output, and live systems when verifying implementation or deployment
3. Long-term product direction and collaboration preferences in this file
4. Repository documentation such as `README.md`
5. Earlier handoffs and status reports, as history only

Call out conflicts and verify them where possible. Before GitHub operations, check the Git root, remote, and branch. Do not merge to `main`, publish or post externally, or change production without the user's explicit authorization.

## Product and goals

- The product is **LimiFile**, formerly called **FileFit**.
- Production site: <https://limifile.com/>. The live site was checked on 2026-09-25.
- The canonical public repository is <https://github.com/Sotaro-Kato443/limifile>. The normal local development checkout is `/Users/sotaro/Developer/limifile-public`. `/Users/sotaro/Developer/LimiFile` is the Archive checkout and is not for normal development.
- The README describes a static Astro site hosted on Cloudflare Pages, with merges to `main` deploying to production. Verify actual configuration and current deployment when needed.
- The main goal is to increase real usage, search traffic, and overall visits by making useful tools. Monetization is not the top priority.
- Evaluate features and pages by user value, actual search demand, implementation effort, and maintenance cost. Open-sourcing, articles, and launches are ways to earn awareness and users, not goals by themselves.
- The long-term direction is to help people create files that meet submission or upload requirements, measure the produced output, and show whether it passes. Reuse common processing code with page-specific presets and validation rather than building a separate engine for every SEO page.

## Product and SEO decisions

- Build useful dedicated pages for distinct search intents. Do not create near-duplicate pages that only rephrase the same intent.
- Before adding pages, examine search demand, Search Console impressions, search results, competitors, user value, implementation cost, and demand by language.
- Size-specific pages, format-specific compression, more conversions, fixed dimensions, metadata tools, application requirements, and PDF tools have been discussed as possibilities. They are not a committed roadmap; check current code and demand before prioritizing them.
- English uses the root paths; Japanese uses `/ja/`. Some fixed-size pages intentionally exist only in English. Spanish, Portuguese, German, and French were mentioned as reserved languages for routing/i18n tests, not as translation plans.
- For third-party submission requirements, verify official sources and record the source and date checked.

## Implementation and privacy

Current source code and `README.md` are authoritative for implementation details. In brief, LimiFile is a static Astro site and image processing runs in browser Web Workers. The app has no feature that uploads a selected image file to a LimiFile server.

Keep privacy language precise. Normal asset requests and limited analytics traffic occur. Do not claim that the whole site makes no network requests or that no data ever leaves the device. Preferred wording:

- English: “Selected images are processed on your device and are not uploaded to a LimiFile server.”
- Japanese: 「選択した画像は端末上で処理され、LimiFileのサーバーにはアップロードされません。」

The README describes Cloudflare Web Analytics and, when configured, Umami custom events. Do not add selected images, file names, dimensions, metadata, or free-form error text to analytics. Existing tests verify that selected File/Blob objects are not passed to certain network APIs; they do not prove that no network traffic occurs.

LimiFile's code and third-party components have different license terms. Before changing licensing, review `LICENSING.md`, `THIRD_PARTY_NOTICES.md`, `TRADEMARKS.md`, the license pages, current packages, and build scripts. Do not describe the whole repository as having one license or imply that the code license grants unrestricted reuse of the brand.

## External publication and announcement history

The following history was provided by the user on 2026-09-24 and has not been independently checked in this repository. Verify the relevant account or page before describing anything as current.

- **GitHub:** The public repository and a `v0.1.0` release were reported as published. Check the current remote and GitHub state before operating on them.
- **Hashnode:** An article titled “How I Test That LimiFile Doesn't Upload Selected Images to Its Server” was reported at <https://strk.hashnode.dev/>.
- **Indie Hackers:** A product page and two posts were reported: one about privacy verification and one announcing the planned Product Hunt launch. The first post reportedly had comments and replies.
- **Product Hunt:** A launch was scheduled for September 12, 2026 at 00:01 Pacific Time (16:01 JST). A public preview, gallery, first comment, and listing information were reportedly set up. The scheduled date has passed; whether the launch occurred and its result remain unknown until verified. Page: <https://www.producthunt.com/products/limifile?launch=limifile>.
- **Show HN:** Posting was reportedly unavailable because of a new-account restriction. Do not try to bypass the restriction.
- **Reddit r/SideProject:** A post was reportedly removed automatically by Reddit's filter. Do not try to bypass the filter.
- Search Console, current analytics settings, deployment state, and dashboard configuration require direct verification. Past repository notes or pull requests do not establish their current state.

## Collaboration preferences

- Work in Japanese by default. When drafting English copy, include a Japanese translation.
- Be candid and evidence-based. Explain the evidence when new information changes a conclusion.
- When possible, verify screenshots and reports against the actual interface, data, or implementation.
- Do not change settled privacy wording for style alone.
- This file is background, not a work request. Follow the user's latest instructions to decide what to do.
