# Licensing

**Do not assume a single license covers this whole repository.**

LimiFile's own source code is licensed under the **Apache License 2.0** (see [`LICENSE`](LICENSE)).
Several files in this repository are **not** LimiFile's own work, or are deliberately placed under
different terms. This document is the authoritative per-path map. Where it and any other document in
this repository disagree about a path, this document governs.

This document is written in English because it is addressed to anyone who redistributes, forks, or
reuses this code. It records facts about licenses and the reasoning behind how they are applied; it
is not legal advice, and it does not assert that every obligation of every upstream license has been
satisfied.

Copyright for LimiFile's own code: **© 2026 Sotaro Kato**.

`LICENSE` is the canonical Apache License 2.0 text, reproduced verbatim from
<https://www.apache.org/licenses/LICENSE-2.0.txt> with no modifications. The placeholders in its
APPENDIX are left unfilled on purpose, so that the file stays byte-identical to the canonical text;
the copyright line above is the operative statement of ownership.

## Per-path license map

| Path                                                                                                                                            | License                                            | Notes                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/**`, `scripts/**`, `test/**` (except the fixtures listed below), `.github/**`, `.vscode/**`, `.claude/**`, root config files, project docs | **Apache-2.0** © 2026 Sotaro Kato                  | LimiFile's own work. This is the default for anything not listed below.                                                   |
| `test/fixtures/heic/synthetic-fixture.heic`, `test/fixtures/heic/synthetic-reference.png`                                                       | **CC0-1.0**                                        | Already dedicated to the public domain. Not re-licensed here. See `test/fixtures/heic/README.md`.                         |
| `test/fixtures/heic/CC0-1.0.txt`                                                                                                                | CC0 1.0 legal text (Creative Commons)              | Reference text, reproduced verbatim.                                                                                      |
| `public/licenses/*.txt`                                                                                                                         | Each upstream project's own license text           | Verbatim copies (Apache-2.0, GPL-3.0, LGPL-3.0, MIT variants, LLVM Exception). **Not LimiFile's work; not granted here.** |
| `public/source/filefit-heic-decoder-1.0.0-source.tar.gz`                                                                                        | **Mixed** — governed by `LICENSE-MAP.md` inside it | Apache-2.0 (jSquash), LGPL-3.0-or-later (libheif, libde265), and a narrow package-scoped MIT grant. See below.            |
| `public/brand/**`, `public/favicon.ico`, `public/favicon-32x32.png`, `public/apple-touch-icon.png`, the brand values in `src/config/brand.ts`   | **Not covered by the code license**                | See [`TRADEMARKS.md`](TRADEMARKS.md).                                                                                     |
| `public/googlea6d7326804b56d45.html`                                                                                                            | Not licensed as a work                             | A Google-issued site-ownership verification token. It carries no creative content to license.                             |
| `node_modules/**` (not committed) and everything it brings into a build                                                                         | Each dependency's own license                      | See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).                                                                   |

## If you redistribute or redeploy LimiFile, read this

The HEIC conversion feature ships a WebAssembly module (`heic_dec.wasm`, from `@discourse/heic`)
that has **libheif and libde265 statically linked into it**. Those libraries are under
**LGPL-3.0-or-later**.

Apache-2.0 applies to LimiFile's own code. It does not, and cannot, waive whatever conditions the
LGPL places on that WebAssembly module. **LimiFile's own compliance design treats a distributed
build of this site as a Combined Work under LGPLv3 §4** — and therefore as carrying that section's
conditions, including its notice requirements and keeping relinking against a modified library
possible.

That is LimiFile's working interpretation for its own distribution, not a determination of your
situation. **If you distribute a build, read LGPLv3 §4 yourself and reach your own conclusion about
how it applies to you.**

This is the most common way to get this wrong: "the LICENSE file says Apache-2.0, so I can do
anything" is not correct for the HEIC decoder.

How LimiFile currently addresses this is documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
and in the source package at `public/source/filefit-heic-decoder-1.0.0-source.tar.gz`. That record
describes LimiFile's own technical and license self-review; it is not a legal opinion, and it does
not establish what your obligations are. If you build a version without the HEIC feature, these
HEIC-specific LGPL conditions do not arise from this module — which says nothing about the terms of
any other component you ship.

## The HEIC source package is frozen

`public/source/filefit-heic-decoder-1.0.0-source.tar.gz` corresponds to `@discourse/heic@1.0.0` and
is **not regenerated** as part of adopting Apache-2.0. Its recorded SHA-256 stays valid, and the
byte-for-byte rebuild evidence built on that hash stays intact. Two consequences:

1. **Its `LICENSE-MAP.md` governs its contents, not this document.** The package deliberately mixes
   licenses and carries its own per-file map.
2. **Its README says LimiFile's own code "does not currently carry an explicit license."** That was
   accurate when the package was published and is a point-in-time statement. It is now superseded by
   `LICENSE` in this repository. The package is left unmodified rather than corrected, because
   regenerating it would change its hash and invalidate the reproducibility record that the package
   exists to support.

## `heic-convert.worker.ts` exists under two grants

The source package contains `application-code-candidates/heic-convert.worker.ts`, a point-in-time
copy of this repository's `src/components/image-intake/heic-convert.worker.ts`, under a narrow
package-scoped MIT grant (`licenses/mit-filefit-relink-support.txt` inside the package).

That grant was made to already-distributed copies and is not withdrawn by this repository adopting
Apache-2.0. Both statements are true at the same time:

- the file in **this repository** is Apache-2.0;
- the copy **inside that package** is available under that package-scoped MIT grant.

The two grants can coexist for their respective copies; no conflict is apparent in this repository's
licensing map. It is recorded here so that neither "the whole repository is MIT" nor "the package
grant was revoked" is inferred.

## Patents

Apache-2.0 §3 grants a patent license covering patent claims **that a contributor owns or controls**.
It does not grant rights to third-party patents that LimiFile does not hold.

In particular, it grants nothing with respect to HEVC/H.265 patents held by others. Patent questions
around HEVC are outside the scope of this repository's license documentation, consistent with the
existing note in `THIRD_PARTY_NOTICES.md`.

## There is no `NOTICE` file, on purpose

Apache-2.0 §4(d) obliges redistributors to propagate a `NOTICE` file **if one exists**. LimiFile does
not ship one, which keeps that obligation from arising for anyone downstream.

Third-party attribution is handled separately and more thoroughly by
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and by the `/licenses/` page on the site. Adding a
`NOTICE` file would duplicate that work under a different name and invite confusion about which one
is authoritative.

## Contributing

Contributions are accepted under Apache-2.0 (inbound = outbound). By submitting a change you confirm
you have the right to license it on those terms.

---

Japanese readers: the detailed third-party component inventory
([`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)) and the user-facing license pages
(`/licenses/`, `/ja/licenses/`) are the companion documents to this one.
