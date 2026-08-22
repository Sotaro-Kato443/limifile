# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.** A public
report is visible to everyone from the moment it is filed, including to anyone
who would use it before it is fixed.

Report privately by email:

**bunmeiproducts@gmail.com**

This is the same address published on <https://limifile.com/contact/>.

Once this repository is public, GitHub's Private Vulnerability Reporting will
be enabled on it as well, and reports through that channel are equally welcome.
Until then — and at any time, if you prefer — email is the reliable route.

A useful report usually includes what you did, what happened, what you expected
instead, and the browser and OS you saw it on. A minimal reproduction helps more
than anything else. If you are unsure whether something qualifies, send it
anyway; sorting that out is not your job.

## What to report privately

Report these by email rather than as an issue:

- **A selected file leaving the device unintentionally.** LimiFile's central
  claim is that selected images are processed in the browser and are not
  uploaded to a LimiFile server. Anything that contradicts that — a code path,
  a build artifact, an observed request — belongs here.
- **Cross-site scripting or arbitrary code execution**, including anything
  where page content, a file name, or image metadata reaches an execution or
  DOM-injection sink.
- **A serious safety problem triggered by processing a malicious file** — for
  example a crafted image that causes memory corruption, an exploitable crash,
  or resource exhaustion severe enough to be usable against a visitor.
- **Dependency and supply-chain issues** — a known vulnerability in a shipped
  dependency, a compromised package, or a tampered build artifact.
- **Privacy boundary violations** — image bytes, file names, image dimensions,
  or metadata reaching analytics or any third party, beyond what the
  [privacy policy](https://limifile.com/privacy/) describes.

## What is an ordinary issue instead

These are normal bug reports and are fine to open publicly:

- A conversion or compression failing on a particular file or browser
- A requested target size not being reached — this is documented as not
  guaranteed
- An unsupported format behaving as documented (animated WebP, APNG, and
  similar)
- Layout, wording, translation, or accessibility problems
- Feature requests

The line is not always obvious. When in doubt, email — an unnecessary private
report costs nothing, and a public report of a real vulnerability cannot be
taken back.

## What we can commit to

We will read every report, investigate what we can reproduce, and tell you what
we conclude. If a fix is warranted, it will be made and deployed. If you would
like credit, say so and we will credit you.

Being straight about the limits:

- **No response-time guarantee.** LimiFile is maintained by one person.
  Publishing a target that cannot be reliably met would be worse than
  publishing none.
- **No bug bounty**, and no compensation for reports.
- **No guarantee that LimiFile is free of vulnerabilities.** This document
  describes how reports are handled, not a warranty of security. The
  [terms](https://limifile.com/terms/) govern warranties, and the site is
  provided as-is.
- **Third-party components carry their own risk.** LimiFile bundles
  WebAssembly built from libheif and libde265, among other dependencies. A
  vulnerability in one of them is worth reporting here — we would want to know,
  and we can update or mitigate — but the fix itself may have to come from
  upstream. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Scope

This policy covers the LimiFile source in this repository and the site served
at <https://limifile.com/>.

It does not cover the underlying platforms — Cloudflare, GitHub, and similar —
whose own security processes apply to them. Please report issues in those
services to those vendors directly.

## Testing against the live site

Please keep testing to what you would do as an ordinary visitor, using your own
images. Do not run automated scanners, load tests, or anything that degrades the
service for other people. Nothing here requires an account, so there are no
other users' accounts to reach.

Every tool works entirely in your browser, so you can test locally instead —
clone the repository, run `npm ci && npm run dev`, and you have the same
application without touching production at all. For most security testing, that
is the better environment anyway.
