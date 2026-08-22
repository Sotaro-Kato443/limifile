# Contributing to LimiFile

Thanks for considering a contribution.

Found a security problem? Do not open an issue — see
[SECURITY.md](SECURITY.md).

## Licensing of contributions

Contributions are accepted under the **Apache License 2.0** — the same license
this project's own code carries (inbound = outbound). This is the standard
arrangement Apache-2.0 §5 describes: unless you state otherwise in the
contribution itself, anything you submit for inclusion is licensed under
Apache-2.0.

By submitting a contribution you confirm that you have the right to license it
on those terms — that it is your own work, or that you are otherwise permitted
to contribute it.

There is **no CLA and no DCO sign-off requirement**. If that ever changes, it
will be announced before it applies, not applied retroactively.

Note what this does _not_ cover: the LimiFile name, logo, and brand assets sit
outside the code license — see [TRADEMARKS.md](TRADEMARKS.md). And the
repository is not under a single license; [LICENSING.md](LICENSING.md) is the
authoritative per-path map.

## Setup

Node.js 22 (LTS). `.nvmrc` pins it for nvm and similar tools.

```bash
npm ci
npm run dev
```

## Before opening a pull request

Run everything CI runs. All of it should pass locally first:

```bash
npm run lint
npm run typecheck
npm run test
npm run format:check
npm run build
```

Then the seven verification scripts, which check the **build output** rather
than the source:

```bash
npm run verify:404
npm run verify:licenses
npm run verify:i18n-seo-foundation
npm run verify:trust-pages
npm run verify:tool-seo-content
npm run verify:search-publication
npm run verify:lgpl-heic-source-package
```

If one of these fails, read what it is asserting before changing it. Several
exist specifically to fail when documentation drifts away from what is actually
shipped — in those cases the documentation is what needs updating, not the
check.

## Things that need extra care

### Privacy architecture

LimiFile's central claim is that a selected image is processed in the browser
and is never uploaded to a LimiFile server.
[test/no-file-upload.test.tsx](test/no-file-upload.test.tsx) enforces it: from
image selection through analysis, `fetch`, `XMLHttpRequest.prototype.send`, and
`FormData.prototype.append` must never be called with a `File` or `Blob`.

If your change touches image intake, a worker, or anything that could put file
data on a network path, run that test and make sure it still covers your code
path. **Do not weaken or skip it to make a change pass.** If you believe the
test needs to change, say why in the pull request — that is a design discussion,
not a mechanical fix.

The same applies to analytics. Event payloads are allow-listed in code down to a
tool identifier and a normalized error code. Adding a field there is a privacy
decision and needs to be reflected in the privacy policy.

### HEIC and the LGPL boundary

The HEIC decoder ships WebAssembly with libheif and libde265 (LGPL-3.0-or-later)
statically linked in, and LimiFile publishes a corresponding source package. If
your change touches that area — the `@discourse/heic` dependency, the HEIC
worker, or the published package — check all of these:

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — versions, licenses, and
  what is actually distributed
- [LICENSING.md](LICENSING.md) — the per-path map and the LGPL section
- `public/source/filefit-heic-decoder-1.0.0-source.tar.gz` — the published
  package. **Do not regenerate it casually.** Its SHA-256 is pinned in
  `THIRD_PARTY_NOTICES.md` and in the rebuild workflow, and the byte-for-byte
  reproducibility record depends on it staying byte-identical.
- `npm run verify:lgpl-heic-source-package` — the lightweight check
- `.github/workflows/verify-lgpl-heic-source-rebuild.yml` — the full rebuild,
  runnable via `workflow_dispatch`

Changing the `@discourse/heic` version means the source package has to be
regenerated and republished under a new version-numbered filename, and every
pinned hash updated with it. That is a deliberate, self-contained change — not
something to fold into an unrelated pull request.

### Adding a dependency

Before adding one:

1. **Check its license.** Confirm it is compatible with Apache-2.0 and record
   the actual license, which is not always what `package.json` claims. `@lucide/astro`
   declares `"ISC"`, but the license file it ships also carries Feather's MIT
   license for a subset of its icons — both apply, and both are documented.
2. **Determine whether it reaches the browser.** The notices distinguish
   build-time-only dependencies from ones actually shipped to visitors, and the
   distinction is load-bearing.
3. **Update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the
   `/licenses/` pages** in both locales, and add the license text under
   `public/licenses/`.
4. Run `npm run verify:licenses`. It derives what is shipped from the built
   HTML, so it will fail until the documentation matches reality.

Prefer not adding a dependency at all. The site currently ships no UI library
and no icon-font runtime, and that is worth keeping.

### Keeping the two READMEs in sync

[README.md](README.md) is English and [README.ja.md](README.ja.md) is Japanese.
They are meant to stay equivalent in substance and parallel in structure.

If you change a fact in one, change it in the other. `test/trust-pages.test.ts`
runs its assertions over both files, so a fact that exists in only one of them
will usually fail the suite — but the tests cannot catch every divergence, so
please update both deliberately.

Improving only one language's wording — clarity, phrasing, typos — is fine and
does not require touching the other.

## Pull requests

- Branch from `main` and keep pull requests focused on one change.
- Explain _why_, not only _what_. The reasoning is the part that is hard to
  recover later.
- Describe what you ran and what you observed. If something did not pass, say so
  rather than leaving it out.
- New behavior should come with tests. This repository leans heavily on them.
- Follow the surrounding code: comments in this codebase explain the reasoning
  behind non-obvious decisions, and existing files are the best style guide.

Opening an issue first is welcome for anything large, so effort does not go
into an approach that will not be merged.

## What is out of scope

- Adding server-side processing or image upload. This is deliberately a static,
  browser-only site.
- Changes that require accounts, tracking, or storing user images.
- Removing the privacy guarantees or the tests that enforce them.
