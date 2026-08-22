# LimiFile

Browser-based image tools. Format conversion, compression, and metadata removal all run on the
user's own device, inside the browser — LimiFile implements no feature that uploads a selected image
to a LimiFile server.

- Production: <https://limifile.com/>
- English (no prefix) and Japanese (`/ja/`)
- Static Astro site, deployed on Cloudflare Pages
- LimiFile's own code is Apache-2.0 — but the repository is **not** under a single license. See
  [LICENSING.md](LICENSING.md).

日本語版のREADMEは [README.ja.md](README.ja.md) にあります。

## What it does

Every tool shares the same processing core and Web Workers. Most are available in both languages;
the fixed 20/50/100/200KB targets, AVIF→JPG, and the signature resizer are English-only (see
[Pages](#pages)).

- Inspect a selected image's format, size, and dimensions
- HEIC/HEIF → JPG
- Compress a JPEG, HEIC, or WebP image toward a size you choose
- Compress a JPEG, HEIC, WebP, or PNG image toward a fixed 20/50/100/200/500KB target
- Strip metadata from a JPEG or HEIC image
- PNG → WebP
- Compress a PNG toward a size you choose
- PNG → JPG (transparent areas are filled with a background color you pick; white by default)
- WebP → JPG (plain and transparent WebP; transparency filled as above; animated WebP unsupported)
- AVIF → JPG
- Resize a signature image to fixed pixel dimensions under a size limit

Site-wide:

- English as the prefix-less default locale, Japanese under `/ja/`
- A LanguageSwitcher built from static components — no JavaScript, cross-linking the same page in
  the other language
- Per-locale canonical, reciprocal en/ja hreflang, and x-default (always the English page)
- Localized 404 pages (`/404` and `/ja/404`)
- Open source license listings and the published HEIC source package (`/licenses/`, `/ja/licenses/`)
- Privacy policy, terms, and contact pages (`/privacy/`, `/terms/`, `/contact/`, and under `/ja/`)

Each tool page documents what it can do, how to use it, its important limits, its privacy behavior,
an FAQ, and links to related tools. Format-specific limits and the fact that a requested target size
is not guaranteed are stated on each page and in the [terms](https://limifile.com/terms/).

## Privacy architecture

This is the part worth reading if you are evaluating the project.

- **No code path sends image bytes anywhere.** There is no `fetch`, `XMLHttpRequest`, or `FormData`
  call in this repository that transmits a selected image, its file name, or its EXIF/GPS data to a
  server or to an analytics service.
- **A regression test enforces it.** [test/no-file-upload.test.tsx](test/no-file-upload.test.tsx)
  asserts that between selecting an image and finishing analysis, `fetch`,
  `XMLHttpRequest.prototype.send`, and `FormData.prototype.append` are never called with a `File` or
  `Blob`. Read the limit honestly: this proves selected files are not transmitted, **not** that no
  network traffic occurs at all. Ordinary static asset fetches (HTML/CSS/JS/WASM) are outside its
  scope.
- **The claim is shown where it matters.** A privacy notice sits directly under the image drop zone
  on every tool page.
- **Analytics is deliberately narrow.** Cloudflare Web Analytics covers page views, referrers, and
  device class. Where `PUBLIC_UMAMI_WEBSITE_ID` is set, Umami Cloud additionally receives exactly
  four events — `process_start`, `process_success`, `process_error`, `download`. Umami's automatic
  pageview tracking is disabled.
- **Umami payloads are allow-listed in code** down to `tool_id` plus, on failure only, a normalized
  `error_code`. Images, image contents, file names, file sizes, dimensions, metadata, output files,
  and free-form error text are never sent.
- Separately from that payload, Umami records its own standard fields on receipt: an anonymous
  session, the URL path/hostname/referrer, browser, OS, device type, screen size, language,
  approximate region, and timestamp. LimiFile sets no Umami Distinct ID or other user identifier.
- Full details: [privacy policy](https://limifile.com/privacy/)
  ([Japanese](https://limifile.com/ja/privacy/)).

## Pages

Every final URL has a trailing slash (`trailingSlash: "always"`). Cloudflare Pages 301-redirects the
slash-less form.

### English (no prefix) — 19 pages

| Page                    | URL                                                                 |
| ----------------------- | ------------------------------------------------------------------- |
| Home                    | `/`                                                                 |
| HEIC→JPG                | `/heic-to-jpg/`                                                     |
| Compress to a target    | `/compress-image/`                                                  |
| 500KB                   | `/compress-image-to-500kb/`                                         |
| 20KB (English only)     | `/compress-image-to-20kb/`                                          |
| 50KB (English only)     | `/compress-image-to-50kb/`                                          |
| 100KB (English only)    | `/compress-image-to-100kb/`                                         |
| 200KB (English only)    | `/compress-image-to-200kb/`                                         |
| Remove metadata         | `/remove-exif/`                                                     |
| PNG→WebP                | `/png-to-webp/`                                                     |
| Compress PNG            | `/compress-png/`                                                    |
| PNG→JPG                 | `/png-to-jpg/`                                                      |
| WebP→JPG                | `/webp-to-jpg/`                                                     |
| AVIF→JPG (English only) | `/avif-to-jpg/`                                                     |
| Signature resizer (En.) | `/signature-resizer/`                                               |
| Open source licenses    | `/licenses/`                                                        |
| Privacy policy          | `/privacy/`                                                         |
| Terms                   | `/terms/`                                                           |
| Contact                 | `/contact/`                                                         |
| 404                     | `/404` (200 when fetched directly; served as 404 for unknown paths) |

### Japanese (`/ja/`) — 13 pages

The same structure exists under `/ja/` for everything except the six English-only pages above (for
example `/ja/heic-to-jpg/`, `/ja/licenses/`, `/ja/privacy/`). The Japanese 404 is `/ja/404`.

The four fixed-size pages, `/avif-to-jpg/`, and `/signature-resizer/` have no `/ja/` counterpart.
That is deliberate: search demand for these specific tools and byte targets differs sharply between
languages, and creating pages with no real audience would add maintenance cost without value.
`/compress-image-to-500kb/` remains available in both languages.

There is no `/en/` URL — English is canonical without a prefix. There is no automatic
language redirect either; visitors switch languages explicitly via the header LanguageSwitcher.

## Tech stack

| Area             | Choice                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Language         | TypeScript                                                                                                                                    |
| Site framework   | [Astro](https://astro.build) (`output: "static"`; no database, no Cloudflare Functions, no SSR)                                               |
| i18n routing     | Astro's built-in i18n routing (`defaultLocale: "en"`, `locales: ["en","ja"]`, `prefixDefaultLocale: false`; no automatic language redirect)   |
| Image-tool UI    | [Preact](https://preactjs.com), mounted as islands via `@astrojs/preact`                                                                      |
| Heavy processing | Dedicated Web Workers, so HEIC decoding, PNG encoding, and compression never block the main thread                                            |
| Styling          | Plain CSS (`src/styles/global.css`); no UI library                                                                                            |
| Icons            | [Lucide](https://lucide.dev), inlined as SVG at build time; no icon JavaScript is shipped                                                     |
| Lint / format    | ESLint (typescript-eslint) + Prettier                                                                                                         |
| Tests            | Vitest + @testing-library/preact + jsdom                                                                                                      |
| Hosting          | Cloudflare Pages (static; build `npm run build`, output `dist`)                                                                               |
| Analytics        | Cloudflare Web Analytics + Umami Cloud (four allow-listed anonymous tool events; disabled when the environment variable is unset)             |
| Package manager  | npm                                                                                                                                           |
| HEIC decoding    | [@discourse/heic](https://github.com/discourse/jSquash) — an Apache-2.0 wrapper whose bundled WASM comes from libheif/libde265 under LGPL-3.0 |

## Getting started

Node.js 22 (LTS) is required; `.nvmrc` pins it for nvm and similar tools.

```bash
npm ci
npm run dev
```

Other commands:

```bash
npm run build        # generate the static site into dist/. Afterwards a fixup script converts the
                     # nested Japanese 404 (dist/ja/404/index.html) into the flat file Cloudflare's
                     # nearest-404 lookup needs (dist/ja/404.html).
npm run preview      # preview the build output locally
npm run lint         # ESLint
npm run typecheck    # astro check (TypeScript)
npm run test         # Vitest
npm run format       # Prettier, writing changes
npm run format:check # Prettier, diff check only
```

## Verification scripts

These run in CI against the build output in `dist/`. Each one builds first if `dist/` is missing.

```bash
npm run verify:404                      # English and Japanese 404 content, and Cloudflare's static 404 behavior
npm run verify:licenses                 # what each page actually ships, and whether the license pages say so accurately
npm run verify:i18n-seo-foundation      # lang / canonical / hreflang / x-default / noindex on every ordinary page
npm run verify:trust-pages              # privacy, terms, and contact in both locales
npm run verify:tool-seo-content         # title/description uniqueness, FAQ, related links, and per-page indexable behavior
npm run verify:search-publication       # robots.txt and sitemap.xml in release-mode builds, and their absence otherwise
npm run verify:lgpl-heic-source-package # lightweight check of the published HEIC source package
```

`verify:licenses` is worth singling out: it derives what is shipped from the built HTML rather than
trusting the documentation, so a new dependency or icon fails the build until the license notices
are updated.

Regression coverage also includes a real HEIC→JPG decode test against a synthetic fixture committed
to the repository ([test/fixtures/heic/synthetic-fixture.heic](test/fixtures/heic/synthetic-fixture.heic)
— CC0, generated by code, not a photograph of anyone) alongside the no-upload test above.

## Search indexing control

A site-wide gate keeps everything out of search engines regardless of per-page settings, via the
`PUBLIC_ALLOW_INDEXING` environment variable ([site-indexing.ts](src/config/site-indexing.ts)).

- Per-page `indexable` settings are consulted **only** when `PUBLIC_ALLOW_INDEXING` is exactly the
  string `"true"`
- Unset, `"false"`, or anything else means every page is noindex — the safe direction
- A page whose own `indexable` is `false` stays noindex even when the site-wide gate is open
- Final decision: `globalIndexingEnabled && pageIndexable`

The home page and the 14 tool pages carry per-page `indexable: true`, having been given real search
content first (title, meta description, intro, features, usage, limits, privacy, FAQ, related
links). The licenses, privacy, terms, and contact pages are pinned to `indexable: false`.

`PUBLIC_ALLOW_INDEXING` is **not** managed in this repository — it is a Cloudflare Pages project
environment variable, so its current production value cannot be determined from this code alone. If
the gate is open, all 15 pages become indexable on the next production deploy and are added to
`sitemap.xml`. Cloudflare Pages environment variables are never committed here; locally you can use
a `.env` file (gitignored), and only variable names and descriptions live in
[.env.example](.env.example).

### Umami tool events

Umami does not replace Cloudflare Web Analytics; it only adds whether in-browser processing started,
how it ended, and whether the output was retrieved. The tracker is configured with
`data-auto-pageview="false"`, `data-exclude-search="true"`, `data-exclude-hash="true"`, and
`data-do-not-track="true"`.

To enable it:

1. Create a website in Umami Cloud
2. Set the resulting website UUID as the `PUBLIC_UMAMI_WEBSITE_ID` production environment variable in
   Cloudflare Pages
3. Redeploy and confirm the four events in Umami's Realtime/Events view using a synthetic test image

Leave `PUBLIC_UMAMI_SCRIPT_URL` unset; it defaults to `https://cloud.umami.is/script.js` and only
needs overriding for a self-hosted tracker (HTTPS only). The website UUID is a public identifier
exposed in the tracker tag, but per-environment values are kept in Cloudflare Pages rather than
hard-coded. In preview and local environments, no external script is loaded and no event is sent
unless `PUBLIC_UMAMI_WEBSITE_ID` is set.

### robots.txt and sitemap.xml (release-mode builds only)

`npm run build` runs [scripts/generate-search-publication-files.mjs](scripts/generate-search-publication-files.mjs)
after the Astro build and the Japanese 404 fixup.

- In an ordinary build (`PUBLIC_ALLOW_INDEXING` not exactly `"true"` — always the case in CI and
  preview), `dist/robots.txt` and `dist/sitemap.xml` are **not generated**, and any stale
  release-mode artifacts left in `dist/` are removed.
- Only a release-mode build scans `dist/` and includes pages that have a canonical URL and no
  noindex. That is currently exactly 24 URLs — the home page plus 14 tool pages in English, and the
  home page plus 8 tool pages in Japanese. Licenses, privacy, terms, contact, the 404s, and `/en/`
  are excluded. The expected count is derived from the manifest in
  [scripts/lib/site-pages.mjs](scripts/lib/site-pages.mjs) rather than hard-coded, and a mismatch
  fails the build instead of writing files.
- `sitemap.xml` contains only absolute, trailing-slash canonical URLs rooted at
  `https://limifile.com`. No `lastmod`, `changefreq`, `priority`, or `xhtml:link` — hreflang already
  exists in each page's head, and invented `lastmod` values would be worse than none.
- `robots.txt` is just `User-agent: *` / `Allow: /` / `Sitemap: https://limifile.com/sitemap.xml`.
  Page-level `meta robots` handles noindex.
- **Known behavior**: Cloudflare's content-signals policy may prepend its own content to the
  production `https://limifile.com/robots.txt` response, ahead of this repository's output. That is
  Cloudflare's layer; this repository's build output covers only its own portion.

## Licensing

- LimiFile's own source code is under the **Apache License 2.0** ([LICENSE](LICENSE)).
- **The repository is not offered under a single license.** CC0 test fixtures, upstream license
  texts, the mixed-license HEIC source package, and brand assets each sit outside the code license.
  [LICENSING.md](LICENSING.md) is the authoritative per-path map.
- The LimiFile name, logo, and brand assets are separated from the code license
  ([TRADEMARKS.md](TRADEMARKS.md)).
- Third-party components keep their own licenses — see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the `/licenses/` pages.
- **If you redistribute a build**, note that the HEIC decoder WASM statically links libheif and
  libde265 (LGPL-3.0-or-later). Apache-2.0 does not waive the LGPL's conditions on that module. See
  the LGPL section of [LICENSING.md](LICENSING.md).
- The corresponding source package for that WASM is published at
  `/source/filefit-heic-decoder-1.0.0-source.tar.gz`. The legacy project name in that filename is
  kept deliberately so existing links and hashes stay verifiable.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. In short: contributions are accepted
under Apache-2.0 (inbound = outbound), with no CLA or DCO sign-off. Before opening a pull request,
run the full check set that CI runs:

```bash
npm run lint && npm run typecheck && npm run test && npm run format:check && npm run build
npm run verify:404 && npm run verify:licenses && npm run verify:i18n-seo-foundation \
  && npm run verify:trust-pages && npm run verify:tool-seo-content \
  && npm run verify:search-publication && npm run verify:lgpl-heic-source-package
```

Two conventions are worth knowing before you change anything:

- **Privacy claims are load-bearing.** If a change could cause a selected file to leave the device,
  the no-upload regression test should catch it — do not weaken that test to make a change pass.
- **Facts in the license documents are verified against build output**, not maintained by hand. If
  `verify:licenses` fails, the documentation is what needs updating.

Found a security problem? Do not open an issue — see [SECURITY.md](SECURITY.md).

## Trust pages

- Privacy policy: `/privacy/`, `/ja/privacy/`
- Terms: `/terms/`, `/ja/terms/`
- Contact: `/contact/`, `/ja/contact/`
- Public contact address: `bunmeiproducts@gmail.com` (a mailto link; no contact form or third-party
  form service is used)

All of these are static pages that load no JavaScript and carry `noindex,nofollow`. Their content is
based on the implemented behavior and on code audits. They have not been reviewed by outside legal
counsel and carry no guarantee of legal sufficiency.

## Deployment

- Cloudflare Pages is connected to the `main` branch; merging to `main` deploys to production.
- Build command `npm run build`, output directory `dist`.
- Opening a pull request deploys a Cloudflare Pages preview, linked from the PR checks.
- Production URL: <https://limifile.com/>

## Assumptions and open items

- Node.js is assumed to be LTS (22.x).
- Tool page content reflects the current implementation and its limits. Reaching a requested target
  size, and preserving quality, color, transparency, dimensions, or metadata, are not guaranteed,
  and neither is behavior on any specific browser or OS. See the
  [terms](https://limifile.com/terms/).
- LGPL-3.0 handling for HEIC conversion is documented in [/licenses/](https://limifile.com/licenses/),
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and the source package's own `README.md`. It
  rests on LimiFile's technical and license self-review — not on outside legal review, and not as a
  guarantee of legal sufficiency.
