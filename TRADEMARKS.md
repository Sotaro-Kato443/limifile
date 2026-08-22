# Trademarks and brand assets

The Apache License 2.0 in [`LICENSE`](LICENSE) covers LimiFile's **code**. It does not grant any
right to the LimiFile name or to LimiFile's brand assets.

Apache-2.0 §6 already declines to grant permission to use the licensor's trade names, trademarks,
service marks, or product names. That covers the _name_. It does not, on its own, carve out the
brand _files_ in this repository — image files are copyrightable works that would otherwise fall
under the code license simply because they live here. This document makes that carve-out explicit.

## What is excluded from the code license

**Names**

- "LimiFile"
- "リミファイル"

**Files**

- `public/brand/limifile-mark.svg`
- `public/brand/limifile-wordmark.svg`
- `public/brand/limifile-og.png`
- `public/favicon.ico`
- `public/favicon-32x32.png`
- `public/apple-touch-icon.png`

**Values**

- `BRAND_NAME`, `BRAND_NAME_JA`, and `BRAND_SLUG` in `src/config/brand.ts`

All rights in the above are reserved. They are included in this repository so that the project
builds and runs as published, not as a grant of rights to reuse them.

## What you may do without asking

- Refer to LimiFile by name to describe, review, compare, or link to it. Accurate nominative use is
  not restricted by this document.
- State truthfully that your work is derived from, based on, or a fork of LimiFile.
- Keep the brand files in place while running the code locally for development, evaluation, or
  testing.

## What requires rebranding

If you publish, deploy, or distribute a modified version, **replace the brand assets and use your
own name**. Concretely: swap the files listed above and change the values in `src/config/brand.ts`.

This is the same arrangement many open source projects use to keep code freely reusable while
keeping a single, unambiguous identity for the official release. It exists so that users can tell
which deployment is the official LimiFile at <https://limifile.com/> and which is someone else's
build — not to restrict what you can do with the code.

## What is not permitted

- Presenting your deployment or distribution as the official LimiFile.
- Using the LimiFile name or logo in a way that suggests endorsement, affiliation, or sponsorship
  that does not exist.
- Using the brand assets as your own product's identity.

## Assets that are not brand assets

`public/googlea6d7326804b56d45.html` is a Google-issued site-ownership verification token, not a
brand asset. It is specific to this project's Search Console property and is meaningless elsewhere.
Remove it from forks.

## Questions

If you want to use the LimiFile name or brand assets in a way this document does not allow, ask
first — see the contact address on <https://limifile.com/contact/>.
