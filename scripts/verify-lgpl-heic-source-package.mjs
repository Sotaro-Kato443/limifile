#!/usr/bin/env node
/**
 * Lightweight, network-free CI check for FileFit's HEIC source/relink
 * package (public/source/filefit-heic-decoder-1.0.0-source.tar.gz),
 * published based on FileFit's technical and license self-review.
 *
 * Does NOT rebuild the WASM (that needs Docker + several minutes; see the
 * separate, manually-triggered heavy rebuild workflow). This only checks
 * that the package that's already committed is internally consistent,
 * matches the pinned versions FileFit currently ships, and doesn't contain
 * compliance-assertion or legal-guarantee language it has no business
 * making.
 *
 * Usage: node scripts/verify-lgpl-heic-source-package.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const packagePath = path.join(rootDir, "public/source/filefit-heic-decoder-1.0.0-source.tar.gz");

const EXPECTED = {
  jsquashCommit: "345892e0e48b428d47875a5b5678fbcf58f2880e",
  libheifTag: "v1.19.7",
  libde265Tag: "v1.0.15",
  emscriptenVersion: "3.1.57",
  discourseHeicVersion: "1.0.0",
  prodWasmSha256: "832bfb37148038257e56216d165cfae24a8afaa7cae8fc0ddb1ef4bf495612a9",
  prodJsSha256: "646f18a658f6e0899c9620473ab556b2503dc1e39cbd36fe9dc30d43e0fdf6cc",
  discourseHeicIntegrity:
    "sha512-YMW5o0bHvhL4rjzGt7kpr8geqMEhP7yS20Hh5eMJtDOmHuCqn+icpNLr1ImFygU/yN39MUHVenETXcpDG6PPww==",
  discourseHeicWrapperSha256: {
    "codec/dec/heic_dec.wasm": "832bfb37148038257e56216d165cfae24a8afaa7cae8fc0ddb1ef4bf495612a9",
    "codec/dec/heic_dec.js": "646f18a658f6e0899c9620473ab556b2503dc1e39cbd36fe9dc30d43e0fdf6cc",
    "codec/pre.js": "b4d7da800804a2390eefa7805bb5f4e20cf349681334eb9a1715d2c58a1822b2",
    "decode.js": "6f18fc3f747a9fd5f4683ce023b086b1b793a047a0cf40a0ff3a1b0e9bc35641",
    "utils.js": "e71535eeee820d68b68ece7c8af761c39f3ddec93d3d957d2f83b19191339e0d",
    "index.js": "5394bb5c78af7ba3ffac95c30d8f916a297e8cbb7c1f8bd53e95c9269c0516ea",
    LICENSE: "8c3690b09c168f196446cf5904332023bbc15eb92b6a7cee470ac829e6a65d20",
  },
};

// Phrases this package must never contain, in any file, in either
// language — this is published based on FileFit's technical and license
// self-review, not a legal guarantee or an external-counsel-reviewed
// compliance determination. A hit here means someone (or some future edit)
// overclaimed. Patterns are written to match the affirmative claim itself
// (e.g. "legally guaranteed"), not the negated form this package
// deliberately uses elsewhere (e.g. "not a guarantee of legal
// sufficiency") -- keep new package prose phrased so it never contains
// these substrings even inside a negation (see README.md's phrasing for
// the pattern to follow: "guarantee of legal sufficiency", not "legal
// sufficiency guaranteed").
const FORBIDDEN_ASSERTIONS = [
  /fully\s+compliant/i,
  /LGPL[\s-]*compliant\b/i,
  /compliance\s+(?:is\s+)?(?:confirmed|established|complete)/i,
  /legally\s+guaranteed/i,
  /legal\s+sufficiency\s+confirmed/i,
  /準拠済み/,
  /完全準拠/,
  /法的に問題(?:は)?ない/,
  /法的十分性を保証/,
  /法律上完全に問題ない/,
];

let failures = 0;
function check(label, condition, detail = "") {
  const mark = condition ? "OK  " : "FAIL";
  console.log(`[${mark}] ${label}${detail ? " — " + detail : ""}`);
  if (!condition) failures += 1;
  return condition;
}

if (!check("source package exists", existsSync(packagePath), path.relative(rootDir, packagePath))) {
  console.log(`\n合計失敗数: ${failures}`);
  process.exit(1);
}

const packageBuf = readFileSync(packagePath);
check("source package is non-empty", packageBuf.length > 0, `${packageBuf.length} bytes`);
const packageSha256 = createHash("sha256").update(packageBuf).digest("hex");

// A gzip stream always starts with 0x1f 0x8b. Catches the case where a
// misconfigured host serves an HTML error/fallback page at this URL/path
// instead of the actual archive.
check(
  "source package starts with gzip magic bytes (not an HTML/error fallback)",
  packageBuf.length >= 2 && packageBuf[0] === 0x1f && packageBuf[1] === 0x8b,
  `first bytes: ${packageBuf.subarray(0, 2).toString("hex")}`,
);

// Cloudflare Pages rejects any single deployed asset >= 25MiB.
const CLOUDFLARE_HARD_LIMIT_BYTES = 25 * 1024 * 1024;
const SAFE_TARGET_BYTES = 24 * 1024 * 1024; // 25,165,824 bytes
const mib = packageBuf.length / (1024 * 1024);
const sizeGuidance =
  "If this ever fails: either reduce package contents (see SOURCE-METADATA.json's " +
  "packagedAs fields for what's already been trimmed and why), or switch distribution " +
  "method away from Cloudflare Pages direct-serving (public/source/) to something like " +
  "Cloudflare R2 or a GitHub Release asset instead.";
check(
  "source package is under Cloudflare Pages' 25MiB single-asset hard limit",
  packageBuf.length < CLOUDFLARE_HARD_LIMIT_BYTES,
  packageBuf.length < CLOUDFLARE_HARD_LIMIT_BYTES
    ? `${mib.toFixed(2)} MiB`
    : `${mib.toFixed(2)} MiB -- ${sizeGuidance}`,
);
check(
  "source package is under the 24MiB (25,165,824 byte) safety target",
  packageBuf.length < SAFE_TARGET_BYTES,
  packageBuf.length < SAFE_TARGET_BYTES
    ? `${mib.toFixed(2)} MiB`
    : `${mib.toFixed(2)} MiB -- ${sizeGuidance}`,
);

const workDir = mkdtempSync(path.join(tmpdir(), "lgpl-heic-verify-"));
try {
  execFileSync("tar", ["xzf", packagePath, "-C", workDir]);
  const pkgRoot = path.join(workDir, "filefit-heic-decoder-1.0.0-source");
  check("package extracts to the expected top-level directory", existsSync(pkgRoot));

  const requiredFiles = [
    "README.md",
    "BUILD.md",
    "REPLACE-WASM.md",
    "LICENSE-MAP.md",
    "SOURCE-METADATA.json",
    "SHA256SUMS",
    "Dockerfile",
    "rebuild.sh",
    "verify.mjs",
    "licenses/apache-2.0.txt",
    "licenses/lgpl-3.0.txt",
    "licenses/gpl-3.0.txt",
    "licenses/mit-emscripten.txt",
    "licenses/mit-musl.txt",
    "licenses/apache-2.0-llvm-exception.txt",
    "licenses/mit-filefit-relink-support.txt",
    "jsquash/LICENSE",
    "jsquash/packages/heic/codec/Makefile",
    "jsquash/packages/heic/codec/dec/heic_dec.cpp",
    "jsquash/tools/cpp.Dockerfile",
    "jsquash/tools/build-cpp.sh",
    "wrappers/codec/dec/heic_dec.js",
    "application-code-candidates/heic_dec.cpp",
    "application-code-candidates/heic-convert.worker.ts",
    `upstream/libheif-${EXPECTED.libheifTag}.tar.gz`,
    `upstream/libde265-${EXPECTED.libde265Tag}.tar.gz`,
  ];
  // The full jSquash commit archive is intentionally NOT embedded (see
  // SOURCE-METADATA.json's sources.jsquash.packagedAs) -- only its
  // packages/heic/ + tools/ subtree, as an extracted source tree.
  check(
    "package does NOT embed the full jSquash monorepo archive (size design)",
    !existsSync(path.join(pkgRoot, `upstream/jsquash-${EXPECTED.jsquashCommit}.tar.gz`)),
  );
  for (const rel of requiredFiles) {
    check(`package contains ${rel}`, existsSync(path.join(pkgRoot, rel)));
  }

  // licenses/apache-2.0.txt must be the CANONICAL Apache-2.0 text, distinct
  // from jsquash/LICENSE (jSquash's own applied copy, with jamsinclair's
  // copyright filled into the appendix). Conflating the two would
  // misrepresent what jSquash actually distributes.
  const pkgApachePath = path.join(pkgRoot, "licenses/apache-2.0.txt");
  const jsquashLicensePath = path.join(pkgRoot, "jsquash/LICENSE");
  if (existsSync(pkgApachePath) && existsSync(jsquashLicensePath)) {
    const pkgApacheText = readFileSync(pkgApachePath, "utf8");
    const jsquashLicenseText = readFileSync(jsquashLicensePath, "utf8");
    check(
      "licenses/apache-2.0.txt is the canonical text (no jamsinclair copyright appendix)",
      !pkgApacheText.includes("jamsinclair"),
    );
    check(
      "jsquash/LICENSE is jSquash's own applied copy (has jamsinclair copyright appendix)",
      jsquashLicenseText.includes("jamsinclair"),
    );
    check(
      "licenses/apache-2.0.txt and jsquash/LICENSE are not byte-identical (kept separate on purpose)",
      pkgApacheText !== jsquashLicenseText,
    );
  }

  // rebuild.sh must use the three named modes (baseline/modified-libheif/
  // modified-libde265) and must NOT accept a generic --patch <any-path>
  // argument (a narrower, pre-reviewed set of patch targets replaced that).
  const rebuildShPath = path.join(pkgRoot, "rebuild.sh");
  if (existsSync(rebuildShPath)) {
    const rebuildShText = readFileSync(rebuildShPath, "utf8");
    check("rebuild.sh supports modified-libheif mode", rebuildShText.includes("modified-libheif"));
    check(
      "rebuild.sh supports modified-libde265 mode",
      rebuildShText.includes("modified-libde265"),
    );
    check(
      "rebuild.sh does not accept a generic --patch <path> argument",
      !rebuildShText.includes("PATCH_FILE") && !/--patch\)/.test(rebuildShText),
    );
    check(
      "rebuild.sh deletes the prebuilt reference heic_dec.js/heic_dec.wasm before building",
      /rm -f dec\/heic_dec\.js dec\/heic_dec\.wasm/.test(rebuildShText),
    );
  }

  // heic_dec.cpp duplication integrity: application-code-candidates/heic_dec.cpp
  // must be byte-identical to jsquash/packages/heic/codec/dec/heic_dec.cpp
  // (an intentional copy, not two independently-maintained files).
  const jsquashHeicDecCppPath = path.join(pkgRoot, "jsquash/packages/heic/codec/dec/heic_dec.cpp");
  const appCodeHeicDecCppPath = path.join(pkgRoot, "application-code-candidates/heic_dec.cpp");
  if (existsSync(jsquashHeicDecCppPath) && existsSync(appCodeHeicDecCppPath)) {
    const jsquashSha = createHash("sha256")
      .update(readFileSync(jsquashHeicDecCppPath))
      .digest("hex");
    const appCodeSha = createHash("sha256")
      .update(readFileSync(appCodeHeicDecCppPath))
      .digest("hex");
    check(
      "jsquash/.../heic_dec.cpp and application-code-candidates/heic_dec.cpp are byte-identical",
      jsquashSha === appCodeSha,
      jsquashSha === appCodeSha ? "" : `${jsquashSha} vs ${appCodeSha}`,
    );
  } else {
    check("both heic_dec.cpp copies present to compare", false);
  }

  // SHA256SUMS self-consistency
  const sumsPath = path.join(pkgRoot, "SHA256SUMS");
  if (existsSync(sumsPath)) {
    const lines = readFileSync(sumsPath, "utf8").trim().split("\n").filter(Boolean);
    check("SHA256SUMS lists at least the required files", lines.length >= requiredFiles.length);
    let sumsOk = true;
    for (const line of lines) {
      const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
      if (!match) {
        sumsOk = false;
        continue;
      }
      const [, expectedHash, rel] = match;
      const filePath = path.join(pkgRoot, rel);
      if (!existsSync(filePath)) {
        sumsOk = false;
        continue;
      }
      const actualHash = createHash("sha256").update(readFileSync(filePath)).digest("hex");
      if (actualHash !== expectedHash) sumsOk = false;
    }
    check("every file in SHA256SUMS matches its recorded hash", sumsOk);
  }

  // Metadata cross-checks against what FileFit currently pins.
  const metadataPath = path.join(pkgRoot, "SOURCE-METADATA.json");
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    check(
      "jSquash commit matches expected",
      metadata.sources?.jsquash?.exactCommit === EXPECTED.jsquashCommit,
    );
    check(
      "libheif tag matches expected",
      metadata.sources?.libheif?.exactTag === EXPECTED.libheifTag,
    );
    check(
      "libde265 tag matches expected",
      metadata.sources?.libde265?.exactTag === EXPECTED.libde265Tag,
    );
    check(
      "Emscripten version matches expected",
      metadata.toolchain?.emscriptenVersion === EXPECTED.emscriptenVersion,
    );
    check(
      "@discourse/heic version matches expected",
      metadata.correspondsToNpmPackage?.version === EXPECTED.discourseHeicVersion,
    );
    check(
      "Production WASM SHA-256 recorded matches expected",
      metadata.productionArtifacts?.["heic_dec.wasm"]?.sha256 === EXPECTED.prodWasmSha256,
    );
    check(
      "metadata does not assert compliance",
      metadata.legalStatus?.complianceAsserted === false,
    );
    check(
      "metadata records external legal review as not performed",
      metadata.legalStatus?.externalLegalReviewPerformed === false,
    );
    check(
      "metadata does not require external legal review as a precondition for publication",
      metadata.legalStatus?.externalLegalReviewRequiredForPublication === false,
    );
    check(
      "metadata records this package as published based on self-review",
      metadata.legalStatus?.publishedBasedOnSelfReview === true,
    );
    check(
      "metadata does not claim legal advice was provided",
      metadata.legalStatus?.legalAdviceProvided === false,
    );
    check(
      "metadata does not guarantee legal sufficiency",
      metadata.legalStatus?.legalSufficiencyGuaranteed === false,
    );
    check(
      "metadata records real HEIC decode as unverified",
      metadata.legalStatus?.realHeicDecodeVerified === false,
    );
  } else {
    check("SOURCE-METADATA.json present", false);
  }

  // Dependency-pin drift check: package.json now pins @discourse/heic
  // exactly ("1.0.0", not "^1.0.0"). Verify the installed version, the
  // lockfile's resolved entry, its npm integrity, and every wrapper/WASM
  // file's SHA-256 all still match what this package's narrative
  // and pinned Production hashes assume. Best-effort (node_modules is
  // present in CI via npm ci, and locally after `npm install`).
  const npmHeicDir = path.join(rootDir, "node_modules/@discourse/heic");
  const npmPkgJsonPath = path.join(npmHeicDir, "package.json");
  if (existsSync(npmPkgJsonPath)) {
    const npmPkgJson = JSON.parse(readFileSync(npmPkgJsonPath, "utf8"));
    check(
      "installed @discourse/heic version matches the pinned expectation",
      npmPkgJson.version === EXPECTED.discourseHeicVersion,
      `installed=${npmPkgJson.version}`,
    );

    const rootPkgJsonPath = path.join(rootDir, "package.json");
    const rootPkgJson = JSON.parse(readFileSync(rootPkgJsonPath, "utf8"));
    check(
      "package.json pins @discourse/heic exactly (not a ^ range)",
      rootPkgJson.dependencies?.["@discourse/heic"] === EXPECTED.discourseHeicVersion,
      `package.json range=${rootPkgJson.dependencies?.["@discourse/heic"]}`,
    );

    const lockfilePath = path.join(rootDir, "package-lock.json");
    if (existsSync(lockfilePath)) {
      const lockfile = JSON.parse(readFileSync(lockfilePath, "utf8"));
      const lockEntry = lockfile.packages?.["node_modules/@discourse/heic"];
      check(
        "package-lock.json's @discourse/heic version matches the pinned expectation",
        lockEntry?.version === EXPECTED.discourseHeicVersion,
        `lockfile version=${lockEntry?.version}`,
      );
      check(
        "package-lock.json's @discourse/heic npm integrity matches the pinned expectation",
        lockEntry?.integrity === EXPECTED.discourseHeicIntegrity,
      );
      check(
        "package-lock.json's root dependency range for @discourse/heic is exact (not ^)",
        lockfile.packages?.[""]?.dependencies?.["@discourse/heic"] ===
          EXPECTED.discourseHeicVersion,
      );
    } else {
      check("package-lock.json present for dependency-pin check", false);
    }

    const wrapperFiles = {
      "codec/dec/heic_dec.wasm": path.join(npmHeicDir, "codec/dec/heic_dec.wasm"),
      "codec/dec/heic_dec.js": path.join(npmHeicDir, "codec/dec/heic_dec.js"),
      "codec/pre.js": path.join(npmHeicDir, "codec/pre.js"),
      "decode.js": path.join(npmHeicDir, "decode.js"),
      "utils.js": path.join(npmHeicDir, "utils.js"),
      "index.js": path.join(npmHeicDir, "index.js"),
      LICENSE: path.join(npmHeicDir, "LICENSE"),
    };
    for (const [rel, filePath] of Object.entries(wrapperFiles)) {
      if (!existsSync(filePath)) {
        check(`installed @discourse/heic/${rel} exists`, false);
        continue;
      }
      const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
      const expected = EXPECTED.discourseHeicWrapperSha256[rel];
      check(
        `installed @discourse/heic/${rel} SHA-256 matches the pinned expectation`,
        actual === expected,
        actual === expected ? "" : `expected=${expected} actual=${actual}`,
      );
    }
  } else {
    console.log(
      "(node_modules/@discourse/heic not present -- skipping dependency-pin checks. Run `npm ci` for full coverage.)",
    );
  }

  // Scan every text-ish file in the package for compliance overclaims.
  let overclaimFound = null;
  const scanFile = (rel) => {
    const filePath = path.join(pkgRoot, rel);
    if (!existsSync(filePath)) return;
    const ext = path.extname(filePath);
    if ([".wasm", ".gz", ".tar"].includes(ext)) return;
    const text = readFileSync(filePath, "utf8");
    for (const pattern of FORBIDDEN_ASSERTIONS) {
      if (pattern.test(text)) {
        overclaimFound = `${rel} matches ${pattern}`;
        return;
      }
    }
  };
  for (const rel of [
    "README.md",
    "BUILD.md",
    "REPLACE-WASM.md",
    "LICENSE-MAP.md",
    "SOURCE-METADATA.json",
  ]) {
    scanFile(rel);
  }
  check(
    "no compliance-overclaim language found in package docs",
    overclaimFound === null,
    overclaimFound || "",
  );

  // Required disclaimers present.
  const readmeText = existsSync(path.join(pkgRoot, "README.md"))
    ? readFileSync(path.join(pkgRoot, "README.md"), "utf8")
    : "";
  // Markdown paragraphs wrap across lines, so these checks use \s+ (not a
  // literal space) between words -- a naive literal-phrase match would
  // false-negative on a perfectly fine sentence that happens to wrap.
  check(
    "README states this package is published based on FileFit's technical and license self-review",
    /technical\s+and\s+license\s+self-review/i.test(readmeText),
  );
  check(
    "README states external legal counsel has not reviewed this package",
    /not\s+been\s+reviewed\s+by\s+external\s+legal\s+counsel/i.test(readmeText),
  );
  check("README states this is not legal advice", /not\s+legal\s+advice/i.test(readmeText));
  check(
    "README does not guarantee legal sufficiency",
    /guarantee\s+(?:of\s+legal\s+sufficiency|that\s+every\s+legal\s+interpretation)/i.test(
      readmeText,
    ),
  );
  check(
    "README does not assert LGPL compliance is complete",
    !FORBIDDEN_ASSERTIONS.some((p) => p.test(readmeText)),
  );
  check(
    "README states real HEIC decode was not verified",
    /No real HEIC photo was decoded/i.test(readmeText),
  );
  check("README records a source-retention policy", /## Source retention policy/i.test(readmeText));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

// Cross-check against /licenses (both locales) and THIRD_PARTY_NOTICES.md, if present.
// PR A2-2 split src/pages/licenses.astro (thin route entry) from the actual body content,
// which now lives in src/components/licenses/LicensesContentEn.astro and LicensesContentJa.astro
// (one shared component per locale, reused by both src/pages/licenses.astro and
// src/pages/ja/licenses.astro).
const licensesContentPaths = [
  path.join(rootDir, "src/components/licenses/LicensesContentEn.astro"),
  path.join(rootDir, "src/components/licenses/LicensesContentJa.astro"),
];
for (const licensesContentPath of licensesContentPaths) {
  if (!existsSync(licensesContentPath)) continue;
  const licensesSource = readFileSync(licensesContentPath, "utf8");
  const label = path.basename(licensesContentPath);
  check(
    `/licenses (${label}) references the source package filename`,
    licensesSource.includes("filefit-heic-decoder-1.0.0-source.tar.gz"),
  );
  check(
    `/licenses (${label}) does not claim LGPL compliance is complete`,
    !FORBIDDEN_ASSERTIONS.some((p) => p.test(licensesSource)),
  );
}
const noticesPath = path.join(rootDir, "THIRD_PARTY_NOTICES.md");
if (existsSync(noticesPath)) {
  const noticesSource = readFileSync(noticesPath, "utf8");
  check(
    "THIRD_PARTY_NOTICES.md references the source package filename",
    noticesSource.includes("filefit-heic-decoder-1.0.0-source.tar.gz"),
  );
  check(
    "THIRD_PARTY_NOTICES.md records the source package SHA-256",
    noticesSource.includes(packageSha256),
  );
}

console.log(`\nPackage SHA-256: ${packageSha256}`);
console.log(`合計失敗数: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
