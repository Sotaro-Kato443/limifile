#!/usr/bin/env node
/**
 * Builds FileFit's HEIC decoder source/relink package
 * (public/source/filefit-heic-decoder-1.0.0-source.tar.gz) deterministically
 * from pinned upstream sources.
 *
 * This package is published based on FileFit's technical and license
 * self-review (see PR #13 / THIRD_PARTY_NOTICES.md). It has not been
 * reviewed by external legal counsel and is not legal advice or a guarantee
 * of legal sufficiency -- it does not assert that FileFit's LGPL obligations
 * are fully and conclusively satisfied.
 *
 * Usage: node scripts/build-lgpl-heic-source-package.mjs
 *
 * Upstream archives are cached under .lgpl-heic-package-cache/ (gitignored)
 * and re-downloaded only if missing; every cached (and freshly downloaded)
 * archive is verified against the pinned SHA-256 below before use.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDeterministicTarGz } from "./lib/deterministic-tar.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const cacheDir = path.join(rootDir, ".lgpl-heic-package-cache");
const outputPath = path.join(rootDir, "public/source/filefit-heic-decoder-1.0.0-source.tar.gz");

// Exact, pinned versions — no floating branches, no "latest". These match
// PR #12's audit and successful rebuild (run 30613638427).
const PINNED = {
  jsquashCommit: "345892e0e48b428d47875a5b5678fbcf58f2880e",
  jsquashUrl:
    "https://github.com/discourse/jSquash/archive/345892e0e48b428d47875a5b5678fbcf58f2880e.tar.gz",
  jsquashSha256: "2364afa833575d5eb1431f03bbad8ab4d3bb42a0a98dbeebe58e7658d15ba5d9",
  jsquashArchiveName: "jsquash-345892e0e48b428d47875a5b5678fbcf58f2880e.tar.gz",

  libheifTag: "v1.19.7",
  libheifUrl: "https://github.com/strukturag/libheif/archive/refs/tags/v1.19.7.tar.gz",
  libheifSha256: "8334c7c418f82c30c9bec1f46e6abfd5a8d3c420a3210d5505eb1868696ce0cc",
  libheifArchiveName: "libheif-v1.19.7.tar.gz",

  libde265Tag: "v1.0.15",
  libde265Url: "https://github.com/strukturag/libde265/archive/refs/tags/v1.0.15.tar.gz",
  libde265Sha256: "d4e55706dfc5b2c5c9702940b675ce2d3e7511025c6894eaddcdbaf0b15fd3f3",
  libde265ArchiveName: "libde265-v1.0.15.tar.gz",

  discourseHeicVersion: "1.0.0",
  emscriptenVersion: "3.1.57",
  dockerImage: "emscripten/emsdk:3.1.57",
  dockerImageDigest: "sha256:8b7c9e9e95f3fb92b94876727a35235a8d2908c4d7e2ef2427f78366fd0b1130",

  prodWasmSha256: "832bfb37148038257e56216d165cfae24a8afaa7cae8fc0ddb1ef4bf495612a9",
  prodJsSha256: "646f18a658f6e0899c9620473ab556b2503dc1e39cbd36fe9dc30d43e0fdf6cc",

  // Exact-pin drift guard: @discourse/heic is pinned to "1.0.0" (not "^1.0.0")
  // in package.json specifically so this package's claims about what
  // Production ships cannot silently drift out from under it. These are the
  // SHA-256 values of every file this script reads out of
  // node_modules/@discourse/heic, recorded at the same time the above
  // Production WASM/JS hashes were pinned. If any of these mismatch, this
  // script refuses to build a package (see the "dependency pin" checks in
  // main()) -- the fix is to re-pin these values (and prodWasmSha256/
  // prodJsSha256/discourseHeicIntegrity) deliberately, not to bypass the
  // check.
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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fetchAndVerify(url, filename, expectedSha256) {
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, filename);
  if (!existsSync(cachePath)) {
    console.log(`Fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed for ${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cachePath, buf);
  }
  const buf = readFileSync(cachePath);
  const actual = sha256(buf);
  if (actual !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${filename}\n  expected: ${expectedSha256}\n  actual:   ${actual}\n` +
        `This does NOT necessarily mean the source was tampered with — GitHub's ` +
        `auto-generated tag/commit archives are not guaranteed byte-stable forever. ` +
        `Compare the commit/tag and key file contents before concluding anything.`,
    );
  }
  return { path: cachePath, buffer: buf };
}

// Fails loudly (throws) if the installed @discourse/heic dependency has
// drifted from the exact version/hashes this package's narrative and
// pinned Production SHA-256 values assume. Checked: installed
// node_modules/@discourse/heic package.json version, package-lock.json's
// resolved version + npm integrity for the same package, and the SHA-256 of
// every wrapper/WASM file this script embeds. A version bump alone (with
// unchanged file contents) would still be caught by the version/lockfile/
// integrity checks; a silent republish under the same version number would
// still be caught by the per-file SHA-256 checks.
function verifyDependencyPin({ npmHeicDir, wrapperBuffers }) {
  const npmPkgJsonPath = path.join(npmHeicDir, "package.json");
  if (!existsSync(npmPkgJsonPath)) {
    throw new Error(`${npmPkgJsonPath} not found -- run \`npm ci\` first.`);
  }
  const npmPkgJson = JSON.parse(readFileSync(npmPkgJsonPath, "utf8"));
  if (npmPkgJson.version !== PINNED.discourseHeicVersion) {
    throw new Error(
      `installed @discourse/heic version drifted: expected "${PINNED.discourseHeicVersion}" ` +
        `(package.json now pins this exactly, not "^${PINNED.discourseHeicVersion}"), found ` +
        `"${npmPkgJson.version}". This package must be regenerated after re-pinning ` +
        "PINNED.prodWasmSha256/prodJsSha256/discourseHeicIntegrity/discourseHeicWrapperSha256 " +
        "for the new version -- do not silently continue.",
    );
  }

  const lockfilePath = path.join(rootDir, "package-lock.json");
  const lockfile = JSON.parse(readFileSync(lockfilePath, "utf8"));
  const lockEntry = lockfile.packages?.["node_modules/@discourse/heic"];
  if (!lockEntry) {
    throw new Error(
      "package-lock.json has no node_modules/@discourse/heic entry -- run `npm install`.",
    );
  }
  if (lockEntry.version !== PINNED.discourseHeicVersion) {
    throw new Error(
      `package-lock.json's node_modules/@discourse/heic version ("${lockEntry.version}") does not ` +
        `match the pinned expectation ("${PINNED.discourseHeicVersion}").`,
    );
  }
  if (lockEntry.integrity !== PINNED.discourseHeicIntegrity) {
    throw new Error(
      "package-lock.json's npm integrity for @discourse/heic does not match the pinned value -- " +
        `expected ${PINNED.discourseHeicIntegrity}, found ${lockEntry.integrity}. This could mean a ` +
        "republish under the same version number; investigate before proceeding.",
    );
  }

  for (const [rel, buf] of Object.entries(wrapperBuffers)) {
    const expected = PINNED.discourseHeicWrapperSha256[rel];
    if (!expected) {
      throw new Error(`no pinned SHA-256 recorded for @discourse/heic wrapper file "${rel}"`);
    }
    const actual = sha256(buf);
    if (actual !== expected) {
      throw new Error(
        `node_modules/@discourse/heic/${rel} does not match its pinned SHA-256.\n` +
          `  expected: ${expected}\n  actual:   ${actual}\n` +
          "This file's content changed even though the package version did not. Investigate " +
          "before proceeding -- do not regenerate the source package against unverified input.",
      );
    }
  }
}

function extractFileFromTarGz(archivePath, pathInArchive) {
  return execFileSync("tar", ["xzf", archivePath, "-O", pathInArchive], {
    maxBuffer: 1024 * 1024 * 64,
  });
}

function archiveTopLevelDir(archivePath) {
  const listing = execFileSync("tar", ["tzf", archivePath]).toString("utf8");
  return listing.split("\n")[0].replace(/\/$/, "");
}

// Lists regular files (not directories) inside archivePath whose path starts
// with "<topLevelDir>/<prefix>/". Returns paths relative to prefix.
function listFilesUnderPrefix(archivePath, topLevelDir, prefix) {
  const listing = execFileSync("tar", ["tzf", archivePath]).toString("utf8");
  const needle = `${topLevelDir}/${prefix}/`;
  return listing
    .split("\n")
    .filter((line) => line.startsWith(needle) && !line.endsWith("/") && line.length > 0)
    .map((line) => line.slice(needle.length));
}

function dirEntry(p) {
  return { path: p.endsWith("/") ? p : `${p}/`, typeflag: "5" };
}

function fileEntry(p, content, { executable = false } = {}) {
  return { path: p, content, typeflag: "0", executable };
}

// Given base="a/b" and files=[{rel:"c/d.txt", content}, {rel:"e.txt", content}],
// returns sorted dir + file entries for a/b/, a/b/c/, a/b/c/d.txt, a/b/e.txt.
function treeEntries(base, files) {
  const dirs = new Set([base]);
  for (const { rel } of files) {
    const parts = rel.split("/").slice(0, -1);
    let cur = base;
    for (const part of parts) {
      cur = `${cur}/${part}`;
      dirs.add(cur);
    }
  }
  const entries = [...dirs].sort().map(dirEntry);
  for (const { rel, content } of files) {
    entries.push(fileEntry(`${base}/${rel}`, content));
  }
  return entries;
}

async function main() {
  console.log("== Fetching / verifying pinned upstream sources ==");
  const jsquash = await fetchAndVerify(
    PINNED.jsquashUrl,
    PINNED.jsquashArchiveName,
    PINNED.jsquashSha256,
  );
  const libheif = await fetchAndVerify(
    PINNED.libheifUrl,
    PINNED.libheifArchiveName,
    PINNED.libheifSha256,
  );
  const libde265 = await fetchAndVerify(
    PINNED.libde265Url,
    PINNED.libde265ArchiveName,
    PINNED.libde265Sha256,
  );
  console.log("All 3 upstream archives verified against pinned SHA-256.");

  // Size design note (see PR #13 "package size" discussion): the jSquash
  // *commit archive* is a full-monorepo snapshot (~25MB gzip-compressed —
  // packages/avif, jxl, jxr, webp etc. that have nothing to do with HEIC make
  // up the overwhelming majority of that). Embedding it as a raw .tar.gz
  // blew the source package past Cloudflare Pages' 25MiB single-asset
  // limit, and wrapping an already-gzipped archive in another layer of gzip
  // barely compresses it further. This script still fetches and SHA-256
  // -verifies the full archive (so the exact commit is authenticated before
  // anything is extracted from it), but only embeds the two subtrees this
  // package actually needs — packages/heic/ and tools/ — as an extracted
  // tree, in full (every file, not a hand-picked subset). libheif/libde265
  // are small enough (~2.1MB combined) to keep as their original raw
  // archives, which preserves direct byte-for-byte verifiability against
  // GitHub's own archive for the two actual LGPL-licensed libraries.
  const jsquashTop = archiveTopLevelDir(jsquash.path);
  const jsquashFile = (p) => extractFileFromTarGz(jsquash.path, `${jsquashTop}/${p}`);

  const jsquashHeicFiles = listFilesUnderPrefix(jsquash.path, jsquashTop, "packages/heic").map(
    (rel) => ({ rel, content: jsquashFile(`packages/heic/${rel}`) }),
  );
  const jsquashToolsFiles = listFilesUnderPrefix(jsquash.path, jsquashTop, "tools").map((rel) => ({
    rel,
    content: jsquashFile(`tools/${rel}`),
  }));
  const jsquashLicense = jsquashFile("LICENSE");

  // heic_dec.cpp and Makefile are pulled from jsquashHeicFiles (the single
  // extraction pass above) rather than re-extracted separately, so the copy
  // under application-code-candidates/ is structurally guaranteed to be the
  // exact same bytes as jsquash/packages/heic/codec/dec/heic_dec.cpp -- not
  // just "expected to match", but sourced from the identical in-memory
  // buffer. The integrity check below is defense-in-depth, not the only
  // thing preventing divergence.
  const heicDecCppEntry = jsquashHeicFiles.find((f) => f.rel === "codec/dec/heic_dec.cpp");
  const makefileEntry = jsquashHeicFiles.find((f) => f.rel === "codec/Makefile");
  if (!heicDecCppEntry || !makefileEntry) {
    throw new Error(
      "jsquash/packages/heic tree is missing codec/dec/heic_dec.cpp or codec/Makefile",
    );
  }
  const heicDecCpp = heicDecCppEntry.content;
  const makefile = makefileEntry.content;

  // jSquash's own repository commits a prebuilt reference heic_dec.wasm/
  // heic_dec.js under packages/heic/codec/dec/ (this is NOT source-only --
  // see README.md's "prebuilt WASM" section). It happens to be
  // byte-identical to what @discourse/heic@1.0.0 publishes and to FileFit's
  // Production WASM/JS, because that npm package is built from this exact
  // jSquash commit without further modification. Assert that equivalence
  // explicitly here rather than merely assuming it -- a divergence would
  // mean either the jSquash commit pin or the npm version pin is stale.
  const jsquashPrebuiltWasmEntry = jsquashHeicFiles.find(
    (f) => f.rel === "codec/dec/heic_dec.wasm",
  );
  const jsquashPrebuiltJsEntry = jsquashHeicFiles.find((f) => f.rel === "codec/dec/heic_dec.js");
  if (!jsquashPrebuiltWasmEntry || !jsquashPrebuiltJsEntry) {
    throw new Error(
      "jsquash/packages/heic tree is missing its committed codec/dec/heic_dec.{wasm,js}",
    );
  }
  if (sha256(jsquashPrebuiltWasmEntry.content) !== PINNED.prodWasmSha256) {
    throw new Error(
      "jSquash's own committed packages/heic/codec/dec/heic_dec.wasm does not match the pinned " +
        "Production WASM SHA-256. This reference binary is not used as a rebuild input (rebuild.sh " +
        "deletes it before invoking the source build), but its presence and provenance are still " +
        "described to users as matching Production -- investigate and re-pin before publishing.",
    );
  }
  if (sha256(jsquashPrebuiltJsEntry.content) !== PINNED.prodJsSha256) {
    throw new Error(
      "jSquash's own committed packages/heic/codec/dec/heic_dec.js does not match the pinned " +
        "Production JS SHA-256 -- investigate and re-pin before publishing.",
    );
  }

  const npmHeicDir = path.join(rootDir, "node_modules/@discourse/heic");
  if (!existsSync(npmHeicDir)) {
    throw new Error(
      "node_modules/@discourse/heic not found — run `npm ci` first (the wrapper JS " +
        "files this script embeds come from the installed Production dependency, " +
        "matching exactly what FileFit ships).",
    );
  }
  const decodeJs = readFileSync(path.join(npmHeicDir, "decode.js"));
  const utilsJs = readFileSync(path.join(npmHeicDir, "utils.js"));
  const indexJs = readFileSync(path.join(npmHeicDir, "index.js"));
  const preJs = readFileSync(path.join(npmHeicDir, "codec/pre.js"));
  const heicDecJsGenerated = readFileSync(path.join(npmHeicDir, "codec/dec/heic_dec.js"));
  const npmWasm = readFileSync(path.join(npmHeicDir, "codec/dec/heic_dec.wasm"));
  const npmLicense = readFileSync(path.join(npmHeicDir, "LICENSE"));

  console.log("\n== Verifying @discourse/heic is pinned to the exact expected version/hashes ==");
  verifyDependencyPin({
    npmHeicDir,
    wrapperBuffers: {
      "codec/dec/heic_dec.wasm": npmWasm,
      "codec/dec/heic_dec.js": heicDecJsGenerated,
      "codec/pre.js": preJs,
      "decode.js": decodeJs,
      "utils.js": utilsJs,
      "index.js": indexJs,
      LICENSE: npmLicense,
    },
  });
  console.log(
    "@discourse/heic version, lockfile entry, npm integrity, and all wrapper file/WASM hashes match the pinned expectations.",
  );

  const workerTsPath = path.join(rootDir, "src/components/image-intake/heic-convert.worker.ts");
  const heicConvertWorkerTs = readFileSync(workerTsPath);

  // licApache is the CANONICAL Apache License 2.0 text (verbatim, no
  // per-project copyright appendix filled in) -- distinct from jSquash's own
  // published LICENSE file (jsquash/LICENSE below), which is jSquash's real
  // distributed license text with jamsinclair's copyright line filled into
  // the appendix. Conflating the two would misrepresent what jSquash
  // actually ships; keeping them separate lets this package show both "the
  // license text" and "the license as jSquash actually applied it" without
  // either overwriting the other.
  const licApache = readFileSync(path.join(rootDir, "public/licenses/apache-2.0.txt"));
  const licLgpl = readFileSync(path.join(rootDir, "public/licenses/lgpl-3.0.txt"));
  const licGpl = readFileSync(path.join(rootDir, "public/licenses/gpl-3.0.txt"));
  const licMitEmscripten = readFileSync(path.join(rootDir, "public/licenses/mit-emscripten.txt"));
  const licMitMusl = readFileSync(path.join(rootDir, "public/licenses/mit-musl.txt"));
  const licApacheLlvmException = readFileSync(
    path.join(rootDir, "public/licenses/apache-2.0-llvm-exception.txt"),
  );

  const pkgRoot = "filefit-heic-decoder-1.0.0-source";

  const readme = buildReadme();
  const buildMd = buildBuildMd();
  const replaceWasmMd = buildReplaceWasmMd();
  const licenseMap = buildLicenseMap();
  const mitRelinkSupport = buildMitRelinkSupportLicense();
  const sourceMetadata = buildSourceMetadata({
    heicDecCppSha: sha256(heicDecCpp),
    makefileSha: sha256(makefile),
    appCodeHeicDecCppSha: sha256(heicDecCpp), // same buffer as application-code-candidates/heic_dec.cpp below
  });
  const dockerfile = buildDockerfile();
  const rebuildSh = buildRebuildSh();
  const verifyMjs = buildVerifyMjs();

  // SHA256SUMS lists every other file in the package (paths relative to the
  // package root), computed after all content above is finalized.
  const filesForSums = [
    ["README.md", Buffer.from(readme)],
    ["BUILD.md", Buffer.from(buildMd)],
    ["REPLACE-WASM.md", Buffer.from(replaceWasmMd)],
    ["LICENSE-MAP.md", Buffer.from(licenseMap)],
    ["SOURCE-METADATA.json", Buffer.from(sourceMetadata)],
    ["Dockerfile", Buffer.from(dockerfile)],
    ["rebuild.sh", Buffer.from(rebuildSh)],
    ["verify.mjs", Buffer.from(verifyMjs)],
    ["licenses/apache-2.0.txt", licApache],
    ["licenses/lgpl-3.0.txt", licLgpl],
    ["licenses/gpl-3.0.txt", licGpl],
    ["licenses/mit-emscripten.txt", licMitEmscripten],
    ["licenses/mit-musl.txt", licMitMusl],
    ["licenses/apache-2.0-llvm-exception.txt", licApacheLlvmException],
    ["licenses/mit-filefit-relink-support.txt", Buffer.from(mitRelinkSupport)],
    ["jsquash/LICENSE", jsquashLicense],
    ...jsquashHeicFiles.map(({ rel, content }) => [`jsquash/packages/heic/${rel}`, content]),
    ...jsquashToolsFiles.map(({ rel, content }) => [`jsquash/tools/${rel}`, content]),
    ["wrappers/decode.js", decodeJs],
    ["wrappers/utils.js", utilsJs],
    ["wrappers/index.js", indexJs],
    ["wrappers/codec/pre.js", preJs],
    ["wrappers/codec/dec/heic_dec.js", heicDecJsGenerated],
    ["application-code-candidates/heic_dec.cpp", heicDecCpp],
    ["application-code-candidates/heic-convert.worker.ts", heicConvertWorkerTs],
    ["upstream/libheif-v1.19.7.tar.gz", libheif.buffer],
    ["upstream/libde265-v1.0.15.tar.gz", libde265.buffer],
  ];
  const sha256sums = filesForSums.map(([p, buf]) => `${sha256(buf)}  ${p}`).join("\n") + "\n";

  const entries = [
    dirEntry(pkgRoot),
    fileEntry(`${pkgRoot}/README.md`, Buffer.from(readme)),
    fileEntry(`${pkgRoot}/BUILD.md`, Buffer.from(buildMd)),
    fileEntry(`${pkgRoot}/REPLACE-WASM.md`, Buffer.from(replaceWasmMd)),
    fileEntry(`${pkgRoot}/LICENSE-MAP.md`, Buffer.from(licenseMap)),
    fileEntry(`${pkgRoot}/SOURCE-METADATA.json`, Buffer.from(sourceMetadata)),
    fileEntry(`${pkgRoot}/SHA256SUMS`, Buffer.from(sha256sums)),
    fileEntry(`${pkgRoot}/Dockerfile`, Buffer.from(dockerfile)),
    fileEntry(`${pkgRoot}/rebuild.sh`, Buffer.from(rebuildSh), { executable: true }),
    fileEntry(`${pkgRoot}/verify.mjs`, Buffer.from(verifyMjs), { executable: true }),
    dirEntry(`${pkgRoot}/licenses`),
    fileEntry(`${pkgRoot}/licenses/apache-2.0.txt`, licApache),
    fileEntry(`${pkgRoot}/licenses/lgpl-3.0.txt`, licLgpl),
    fileEntry(`${pkgRoot}/licenses/gpl-3.0.txt`, licGpl),
    fileEntry(`${pkgRoot}/licenses/mit-emscripten.txt`, licMitEmscripten),
    fileEntry(`${pkgRoot}/licenses/mit-musl.txt`, licMitMusl),
    fileEntry(`${pkgRoot}/licenses/apache-2.0-llvm-exception.txt`, licApacheLlvmException),
    fileEntry(`${pkgRoot}/licenses/mit-filefit-relink-support.txt`, Buffer.from(mitRelinkSupport)),
    fileEntry(`${pkgRoot}/jsquash/LICENSE`, jsquashLicense),
    ...treeEntries(
      `${pkgRoot}/jsquash/packages/heic`,
      jsquashHeicFiles.map(({ rel, content }) => ({ rel, content })),
    ),
    ...treeEntries(
      `${pkgRoot}/jsquash/tools`,
      jsquashToolsFiles.map(({ rel, content }) => ({ rel, content })),
    ),
    dirEntry(`${pkgRoot}/wrappers`),
    fileEntry(`${pkgRoot}/wrappers/decode.js`, decodeJs),
    fileEntry(`${pkgRoot}/wrappers/utils.js`, utilsJs),
    fileEntry(`${pkgRoot}/wrappers/index.js`, indexJs),
    dirEntry(`${pkgRoot}/wrappers/codec`),
    fileEntry(`${pkgRoot}/wrappers/codec/pre.js`, preJs),
    dirEntry(`${pkgRoot}/wrappers/codec/dec`),
    fileEntry(`${pkgRoot}/wrappers/codec/dec/heic_dec.js`, heicDecJsGenerated),
    dirEntry(`${pkgRoot}/application-code-candidates`),
    fileEntry(`${pkgRoot}/application-code-candidates/heic_dec.cpp`, heicDecCpp),
    fileEntry(`${pkgRoot}/application-code-candidates/heic-convert.worker.ts`, heicConvertWorkerTs),
    dirEntry(`${pkgRoot}/upstream`),
    fileEntry(`${pkgRoot}/upstream/${PINNED.libheifArchiveName}`, libheif.buffer),
    fileEntry(`${pkgRoot}/upstream/${PINNED.libde265ArchiveName}`, libde265.buffer),
  ];

  // Required integrity check (see "heic_dec.cpp duplication" in README):
  // jsquash/packages/heic/codec/dec/heic_dec.cpp and
  // application-code-candidates/heic_dec.cpp must be byte-identical. They're
  // sourced from the same buffer above, so this should never fire -- but
  // fail loudly rather than silently if a future refactor breaks that.
  const jsquashCopyEntry = entries.find(
    (e) => e.path === `${pkgRoot}/jsquash/packages/heic/codec/dec/heic_dec.cpp`,
  );
  const appCodeCopyEntry = entries.find(
    (e) => e.path === `${pkgRoot}/application-code-candidates/heic_dec.cpp`,
  );
  if (!jsquashCopyEntry || !appCodeCopyEntry) {
    throw new Error("could not locate both heic_dec.cpp entries to verify their integrity");
  }
  if (sha256(jsquashCopyEntry.content) !== sha256(appCodeCopyEntry.content)) {
    throw new Error(
      "jsquash/packages/heic/codec/dec/heic_dec.cpp and application-code-candidates/heic_dec.cpp " +
        "diverged -- they must be byte-identical copies of the same source of truth.",
    );
  }

  const tarGz = createDeterministicTarGz(entries);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, tarGz);

  const mib = tarGz.length / (1024 * 1024);
  console.log("\n== Package built ==");
  console.log(`Output: ${path.relative(rootDir, outputPath)}`);
  console.log(`Size: ${tarGz.length} bytes (${mib.toFixed(2)} MiB)`);
  console.log(`SHA-256: ${sha256(tarGz)}`);

  // Cloudflare Pages rejects any single deployed asset >= 25MiB. Fail loudly
  // here rather than letting an oversized package silently reach a PR.
  const CLOUDFLARE_HARD_LIMIT_BYTES = 25 * 1024 * 1024;
  const SAFE_TARGET_BYTES = 24 * 1024 * 1024;
  if (tarGz.length >= CLOUDFLARE_HARD_LIMIT_BYTES) {
    throw new Error(
      `Package is ${mib.toFixed(2)} MiB, at or over Cloudflare Pages' 25MiB single-asset limit -- ` +
        "this WOULD FAIL to deploy via the Cloudflare Pages direct-distribution design this " +
        "package currently uses. This must be fixed before publishing: either reduce package " +
        "contents (see the packagedAs fields in SOURCE-METADATA.json for what's already been " +
        "trimmed and why), or switch distribution method entirely (e.g. Cloudflare R2 or a " +
        "GitHub Release asset instead of public/source/) -- see PR #13's size-design discussion.",
    );
  }
  if (tarGz.length >= SAFE_TARGET_BYTES) {
    console.warn(
      `WARNING: package is ${mib.toFixed(2)} MiB, over the 24MiB safety target (Cloudflare's ` +
        "hard limit is 25MiB). Consider why before growing it further.",
    );
  }
}

// Files this package's own MIT grant (licenses/mit-filefit-relink-support.txt)
// applies to. Kept as a single source of truth so buildMitRelinkSupportLicense()
// and buildLicenseMap() can't drift out of sync with each other.
const MIT_RELINK_SUPPORT_FILES = [
  "README.md",
  "BUILD.md",
  "REPLACE-WASM.md",
  "LICENSE-MAP.md",
  "Dockerfile",
  "rebuild.sh",
  "verify.mjs",
  "SOURCE-METADATA.json",
  "application-code-candidates/heic-convert.worker.ts",
];

function buildMitRelinkSupportLicense() {
  const fileList = MIT_RELINK_SUPPORT_FILES.map((f) => `  - ${f}`).join("\n");
  return `MIT License (scope-limited — read the scope section before assuming this
applies to anything beyond the files explicitly listed below)

Copyright (c) 2026 Sotaro Kato (FileFit)

## Scope

This license applies ONLY to the following files, as distributed inside this
specific package (filefit-heic-decoder-1.0.0-source.tar.gz):

${fileList}

It does NOT apply to, and no permission is granted here for:

  - The FileFit repository as a whole, or any FileFit application code
    outside this package (including FileFit's own copy of
    src/components/image-intake/heic-convert.worker.ts, which this package's
    application-code-candidates/heic-convert.worker.ts is a point-in-time
    copy of -- that repository file's own license status is unchanged by
    this grant; see README.md "FileFit's own code license status").
  - FileFit's user interface, other image-processing features, site design,
    branding, or any other part of the FileFit product.
  - jSquash's files (jsquash/, application-code-candidates/heic_dec.cpp),
    which remain under jSquash's own Apache License 2.0 (see jsquash/LICENSE
    and licenses/apache-2.0.txt).
  - libheif or libde265 (upstream/, and their object code inside any WASM
    built from this package), which remain under their own upstream licenses
    (GNU LGPL v3, or later, for the libraries themselves; MIT for their
    sample applications) -- see licenses/lgpl-3.0.txt and licenses/gpl-3.0.txt.
  - Emscripten runtime support, embind/emval, or musl, which remain under
    their own upstream licenses -- see licenses/mit-emscripten.txt,
    licenses/mit-musl.txt, and licenses/apache-2.0-llvm-exception.txt.

The purpose of this narrow grant is solely to make clear that the files
listed above -- this package's own rebuild/relink/verification support
material -- may be used, copied, and modified for the purpose of rebuilding,
relinking, and verifying the HEIC decoder WASM this package documents,
without requiring separate permission from FileFit for that narrow purpose.
It is not a statement about, and does not change, the license status of any
other FileFit code, and it is not a determination that these files are (or
are not) legally required "Corresponding Application Code" under the GNU
Lesser General Public License -- see README.md and LICENSE-MAP.md for that
discussion.

## Terms

Permission is hereby granted, free of charge, to any person obtaining a copy
of the files listed in the Scope section above, to deal in those files
without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of those
files, and to permit persons to whom those files are furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of those files.

THOSE FILES ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THOSE FILES OR THE USE OR OTHER DEALINGS IN
THOSE FILES.
`;
}

function buildLicenseMap() {
  return `# LICENSE-MAP.md — per-file/per-tree license map for this package

This package mixes files under several different licenses. Do not assume a
single license applies to the whole \`.tar.gz\` -- use this table. "Scope"
notes where a broader statement (e.g. jSquash's own LICENSE file) governs a
whole subtree, and where this package adds a narrower, package-specific
grant on top of files that would otherwise carry no explicit license.

| Path | License | Copyright | Scope note |
| --- | --- | --- | --- |
| \`jsquash/LICENSE\`, \`jsquash/packages/heic/**\`, \`jsquash/tools/**\`, \`application-code-candidates/heic_dec.cpp\`, \`wrappers/**\` | Apache License 2.0 | jamsinclair (jSquash LICENSE appendix); \`jsquash/packages/heic/utils.ts\` additionally carries "Copyright 2020 Google Inc." with a documented modification note by Jamie Sinclair — see that file's own header | Governed by jSquash's own \`jsquash/LICENSE\` file (unmodified, as jSquash actually distributes it). This package does not add, remove, or alter any notice in this subtree. |
| \`upstream/libheif-v1.19.7.tar.gz\` | GNU LGPL v3 (library, "or any later version"); MIT (\`examples/\`, not built by this package's Makefile) | struktur AG, Dirk Farin | Unmodified upstream archive. See \`licenses/lgpl-3.0.txt\` + \`licenses/gpl-3.0.txt\` (LGPLv3 references GPLv3). |
| \`upstream/libde265-v1.0.15.tar.gz\` | GNU LGPL v3 (library, "or any later version"); MIT (\`dec265/\`, \`enc265/\`, \`sherlock265/\`, not built by this package's Makefile since \`ENABLE_ENCODER=OFF\`/\`ENABLE_SDL=OFF\`) | struktur AG, Dirk Farin | Unmodified upstream archive. Same license texts as libheif above. |
| \`heic_dec.js\`'s generated Emscripten runtime support, and the JS-side implementations of embind/emval registration functions that Production \`heic_dec.wasm\` imports (\`__embind_register_*\`, \`__emval_*\` — see README.md "What a WASM import does and does not prove") | MIT / University of Illinois-NCSA (dual) | The Emscripten Authors | Confirmed by generated-JS inspection (\`heic_dec.js\` implements these as the JS-side counterparts to what the WASM imports). Not embedded as source in this package (see README.md "Emscripten source is not included"). \`licenses/mit-emscripten.txt\` is the exact Emscripten 3.1.57 root LICENSE text, provided for reference. |
| musl-implemented syscall primitives that Production \`heic_dec.wasm\` imports from \`heic_dec.js\` (\`__syscall_openat\`, \`__syscall_getdents64\`, \`__syscall_unlinkat\`, \`fd_read\`/\`fd_write\`/\`fd_seek\`/\`fd_close\`, \`environ_get\`, \`strftime_l\`); whether higher-level musl libc code (e.g. \`opendir\`/\`readdir\`) is additionally *compiled into* the WASM itself, versus only these raw primitives crossing to JS, is **not confirmed** (no symbol-name evidence survives in the stripped WASM either way) | MIT | musl libc project (Rich Felker et al.) | Not embedded as source. \`licenses/mit-musl.txt\` is musl's own COPYRIGHT file from the exact Emscripten 3.1.57 tag. |
| libc++ / libc++abi — confirmed to have object code compiled *into* Production \`heic_dec.wasm\` itself (not merely imported): exported RTTI functions \`___cxa_is_pointer_type\`/\`___getTypeName\`/\`__cxa_increment_exception_refcount\`, and C++ \`__cxxabiv1\` type_info / \`std::string\`-family mangled-name strings. (\`___cxa_throw\` is separately an *import* — the WASM calls out to \`heic_dec.js\`'s JS-implemented throw path rather than implementing native unwinding itself; this is evidence of a call site, not of libc++abi's exception-unwinding machinery being compiled in.) compiler-rt / libunwind are toolchain-default candidates only; whether either is present in the final WASM is **not confirmed** — no symbol, string, or archive-member evidence was found either way | Apache License 2.0 WITH LLVM Exceptions | The LLVM Project | Not embedded as source. \`licenses/apache-2.0-llvm-exception.txt\` is the exact LLVM Project LICENSE.TXT from Emscripten 3.1.57's \`system/lib/libcxx/\`, provided for reference. The LLVM Exception text in that file states that Object-form embedding resulting from compiling this software does not require complying with License sections 4(a), 4(b), and 4(d) — this package records that exact text rather than summarizing it. |
| \`licenses/apache-2.0.txt\` | — (reference text) | Apache Software Foundation | Canonical Apache License 2.0 full text, unmodified, with no per-project copyright appendix filled in. Distinct from \`jsquash/LICENSE\`, which is jSquash's own applied copy of the same license (with jamsinclair's copyright line filled in) — do not treat the two as interchangeable. |
| \`licenses/lgpl-3.0.txt\`, \`licenses/gpl-3.0.txt\` | — (reference text) | Free Software Foundation | Canonical GNU LGPLv3 / GPLv3 full text, unmodified. |
${MIT_RELINK_SUPPORT_FILES.map((f) => `| \`${f}\` | MIT (package-scoped, see \`licenses/mit-filefit-relink-support.txt\`) | Sotaro Kato (FileFit) | FileFit-authored package support material. This narrow MIT grant covers ONLY this file as distributed inside this package — it does not apply to FileFit's repository as a whole, and (for \`application-code-candidates/heic-convert.worker.ts\` specifically) does not change the license status of FileFit's own repository copy of that file. See "Application code candidates" in README.md for why this worker is included as a runtime-integration reference rather than asserted as required Corresponding Application Code. |`).join("\n")}
| \`SHA256SUMS\` | — (factual data, not independently licensed) | — | Per-file hash listing generated by this package's build script. |

## Files this table intentionally does not separately re-license

Nothing in this table overrides or re-licenses \`jsquash/LICENSE\`,
\`upstream/*.tar.gz\`, or any upstream license text. Where this package adds
its own MIT grant, it is additive and narrowly scoped (see
\`licenses/mit-filefit-relink-support.txt\`), never a substitute for an
upstream project's own license.
`;
}

function buildReadme() {
  return `# FileFit HEIC decoder — source and relink package

This source package is published based on FileFit's technical and license
self-review. It provides the source, build material, and documented
procedures used to rebuild and relink the HEIC decoder. **It has not been
reviewed by external legal counsel and is not legal advice or a guarantee
that every legal interpretation of LGPL requirements will agree with this
packaging decision.** It does not, by itself, establish that FileFit's LGPL
obligations are fully and conclusively satisfied. It is a technical
artifact: everything a developer needs to rebuild FileFit's HEIC decoder
WASM from source and relink it against a modified libheif or libde265,
produced and verified in [PR #12](https://github.com/Sotaro-Kato443/filefit/pull/12)
(a technical spike, also not legal advice or a compliance guarantee).

## What is in this package

- \`upstream/\` — the exact, unmodified upstream **archives** for libheif
  \`v1.19.7\` and libde265 \`v1.0.15\`, as fetched directly from GitHub, byte-
  for-byte identical to what \`https://github.com/strukturag/{libheif,libde265}/archive/refs/tags/...\`
  serves. These stay small enough (~2.1MB combined) to include as their
  original archives.
- \`jsquash/\` — jSquash commit \`345892e0e48b428d47875a5b5678fbcf58f2880e\`'s
  \`packages/heic/\` and \`tools/\` directories, **in full** (every file in
  both directories, not a hand-picked subset), extracted as a plain source
  tree rather than embedded as a raw archive. jSquash is a monorepo; that
  same commit also contains \`packages/avif\`, \`packages/jpeg\`,
  \`packages/png\`, \`packages/webp\`, \`packages/jxl\`, \`packages/jxr\`,
  \`packages/oxipng\`, \`packages/qoi\`, \`packages/resize\`, and
  \`packages/gif\` — separate codec packages that FileFit's HEIC build never
  reads, references, or links against (confirmed by \`packages/heic/codec/Makefile\`,
  included here, which only ever touches \`packages/heic/\` and \`tools/\`).
  **This is not a size-driven trim of HEIC-relevant source, and it is not a
  determination of LGPL's "Minimal Corresponding Source" scope** — those
  other packages are technically unconnected to the HEIC WASM build, full
  stop, independent of any licensing question. What counts as sufficient
  Corresponding Source for the HEIC decoder specifically remains a
  legal-interpretation question not conclusively resolved here (see
  "Remaining legal interpretation risks" below); this bullet is about codec
  packages that were never candidates for inclusion in the first place.
  jSquash's own full commit archive is a whole-monorepo snapshot (~25MB
  compressed, ~39MB uncompressed, of which the unrelated codec packages
  above are ~38MB); embedding it raw would have pushed this package over
  Cloudflare Pages' 25MiB single-asset limit for no benefit, since wrapping
  an already-compressed archive in another layer of gzip barely shrinks it
  further. \`SOURCE-METADATA.json\` records the exact commit and the full
  archive's own SHA-256 (the one this package's build script downloaded and
  verified before extracting \`packages/heic/\`/\`tools/\` from it), so the
  omission of the raw monorepo archive does not weaken the provenance claim
  for the files that matter here.
- \`wrappers/\` — the compiled JS wrapper/glue files exactly as published in
  \`@discourse/heic@${PINNED.discourseHeicVersion}\` (the npm package FileFit
  actually depends on, pinned exactly — not a version range — in FileFit's
  own \`package.json\`), copied from the installed \`node_modules\` at build
  time.
- \`application-code-candidates/\` — see "Application code candidates" below.
- \`licenses/\` — reference license texts: canonical Apache-2.0, LGPL-3.0, and
  GPL-3.0 full text; Emscripten's own MIT/University of Illinois-NCSA
  \`LICENSE\`; musl's MIT \`COPYRIGHT\`; the LLVM Project's Apache-2.0-with-
  exceptions \`LICENSE.TXT\`; and this package's own scope-limited MIT grant
  for its support files (\`mit-filefit-relink-support.txt\`). See
  \`LICENSE-MAP.md\` for which license governs which file — this package does
  **not** use a single license for everything it contains.
- \`LICENSE-MAP.md\` — per-file/per-tree license table for this entire
  package. Start here if you need to know what license applies to a specific
  file.
- \`SOURCE-METADATA.json\`, \`SHA256SUMS\` — exact versions/commits/tags,
  compiler/linker/toolchain flags, and per-file hashes for everything in
  this package.
- \`BUILD.md\` — step-by-step rebuild instructions.
- \`REPLACE-WASM.md\` — how a rebuilt/relinked WASM maps onto what FileFit
  actually loads, and how far that technically goes.
- \`Dockerfile\`, \`rebuild.sh\`, \`verify.mjs\` — a runnable build/verify setup
  matching \`BUILD.md\`.

## This package is not source-only — jsquash/ includes a prebuilt reference WASM

\`jsquash/packages/heic/codec/dec/heic_dec.wasm\` and the sibling
\`heic_dec.js\` are part of jSquash's own committed source tree at the pinned
commit — jSquash's repository itself commits these as prebuilt/reference
build output, not source. This package embeds \`packages/heic/\` **in full**
(every file, not a hand-picked subset — see "What is in this package"
above), so this prebuilt pair comes along with it.

This is disclosed explicitly because it means the claim "this package
provides source" is not, by itself, a claim that every file in it is source
form. What matters for rebuilding is:

- \`./rebuild.sh\` **never reads** \`jsquash/packages/heic/codec/dec/heic_dec.js\`
  or \`heic_dec.wasm\` as a build input. It deletes both from its working
  copy immediately after copying \`codec/\`, before invoking the actual
  source build (see \`rebuild.sh\`'s \`rm -f dec/heic_dec.js dec/heic_dec.wasm\`
  step) — so a rebuild can only succeed by actually regenerating them from
  \`heic_dec.cpp\` + the two upstream libraries, never by silently reusing the
  pre-existing files. \`verify-lgpl-heic-source-package.mjs\`'s heavy rebuild
  workflow (in the FileFit repository) additionally checks this behavior.
- This prebuilt pair happens to be byte-identical to
  \`@discourse/heic@${PINNED.discourseHeicVersion}\`'s published WASM/JS and to
  FileFit's Production build (\`${PINNED.prodWasmSha256}\` /
  \`${PINNED.prodJsSha256}\`), which this package's build script asserts and
  fails loudly if it ever stops being true. Its practical use is as a known-
  good reference to compare a fresh rebuild against — not as rebuild input.

## What was technically demonstrated (PR #12, run [30613638427](https://github.com/Sotaro-Kato443/filefit/actions/runs/30613638427))

- Rebuilding from these exact upstream sources reproduces FileFit's current
  Production \`heic_dec.wasm\`/\`heic_dec.js\` **byte-for-byte**
  (WASM SHA-256 \`${PINNED.prodWasmSha256}\`, JS SHA-256 \`${PINNED.prodJsSha256}\`).
- A harmless modification to libheif's source can be relinked into a working
  WASM, and the JS glue file needed no changes to use it (byte-identical
  before/after) — only \`heic_dec.wasm\` needs replacing. See "libde265
  relinking" below for the same demonstration against libde265's source.
- The rebuilt/relinked module instantiates, its \`decode()\` binding is
  callable, and it correctly rejects invalid input.

## What was NOT demonstrated

- **No real HEIC photo was decoded.** No HEIC test image with a clear
  redistribution license was available. Nothing here proves pixel-accurate
  decoding, HEVC/HEIF correctness, or functional equivalence with Production
  on real input.
- **No legal conclusion.** Whether this package satisfies LGPL's
  Corresponding Source requirements — including what counts as Corresponding
  Application Code, whether source-only (no object/bitcode) is sufficient,
  and whether this distribution method and retention period are adequate —
  remain open interpretation questions. See "Remaining legal interpretation
  risks" below.

## Remaining legal interpretation risks

This package is published based on FileFit's own technical and license
self-review, not external legal counsel. The following points are recorded
as risks/interpretation questions that are **not conclusively resolved**
by anything in this package — publishing this package does not mean
FileFit has determined an answer to any of them:

1. Is the Combined Work boundary correctly drawn at the single
   \`heic_dec.wasm\` (libheif + libde265 + jSquash's embind wrapper,
   statically linked), with FileFit's own JS/TS treated as calling code
   outside it?
2. Is Corresponding Application Code limited to jSquash's \`heic_dec.cpp\`,
   or does it extend to jSquash's \`Makefile\`/\`pre.js\`/build settings,
   and/or to FileFit's \`heic-convert.worker.ts\` (which only calls the
   published \`decode()\` through the WASM's public interface)?
3. Is source-only provision sufficient given \`-flto\` makes intermediate
   object files largely non-reusable, or is object/bitcode also required?
4. Does providing \`packages/heic/\` + \`tools/\` (not the full jSquash
   monorepo) fully satisfy "Minimal Corresponding Source" for the HEIC
   decoder, or is something more expected?
5. Is hosting this package ourselves (rather than only linking to
   discourse/jSquash, which has no tags/Releases) sufficient, given FileFit
   is the actual distributor to end users?
6. Is the source-retention policy in this README (available for as long as
   the corresponding WASM is served, version-named packages, no reliance on
   expiring CI artifacts) sufficient, or does LGPL require something more
   specific (e.g. a minimum fixed retention period)?
7. Is linking to this package from \`/licenses\` and the HEIC tool page an
   adequate offer of source, or does LGPL require something more active
   (e.g. a written offer)?
8. Does browser-delivered WASM (via Cloudflare Pages, no server-side
   processing) constitute "conveying" under LGPL terms the way this package
   assumes?
9. Are there reverse-engineering-restriction concerns specific to shipping a
   \`-Oz -flto\`-optimized, symbol-stripped WASM binary?
10. Are HEVC/H.265 patent questions genuinely separable from this LGPL
    analysis, or do they need to be addressed together? (Separately: the
    LLVM Exception's Apache-2.0 §4 waiver for libc++/libc++abi is a distinct
    question from LGPL compliance for libheif/libde265 — the two should not
    be conflated.)
11. Does the System Libraries exclusion (GPLv3 §1 / LGPLv3 §0) actually
    apply to Emscripten's runtime support, embind/emval, and musl for
    FileFit's specific distribution, such that their source need not be
    provided?
12. Is the narrow, package-scoped MIT grant on this package's own support
    files (\`licenses/mit-filefit-relink-support.txt\`) an adequate way to
    satisfy LGPLv3 §4(d)(0)'s requirement that Corresponding Application
    Code be provided "under terms that permit" recombination/relinking,
    without licensing FileFit's repository as a whole?

None of these are treated as blockers to publishing this package — FileFit
is publishing based on its own self-review while these interpretation
questions remain open, rather than withholding the package until an
external legal review resolves them. Absence of an answer here is not
itself evidence either way of legal sufficiency.

## What a WASM import does and does not prove

Several sections below, and \`SOURCE-METADATA.json\`, describe specific
functions that Production \`heic_dec.wasm\` **imports** — meaning it declares
that it needs \`heic_dec.js\` to supply a JavaScript implementation of that
function at instantiation time, not that the WASM implements that function
itself. An import is evidence of a *call site inside the WASM*, not evidence
of an *implementation inside the WASM*. Concretely, for Production
\`heic_dec.wasm\`:

- \`__embind_register_bool\`, \`__embind_register_class\`, \`__emval_call\`,
  \`__emval_new_object\`, and the rest of the \`__embind_register_*\`/\`__emval_*\`
  family are **imports** — the embind/emval *registration bookkeeping* is
  implemented in \`heic_dec.js\`'s generated Emscripten runtime support, not
  inside the WASM. (The C++ code that decides *what* to register —
  compiled from \`heic_dec.cpp\` and Emscripten's \`embind\`/\`bind.cpp\`
  headers — is compiled into the WASM as unnamed internal functions, but the
  registration mechanism itself runs in JS.)
- \`__syscall_openat\`, \`__syscall_getdents64\`, \`__syscall_unlinkat\`,
  \`fd_read\`, \`fd_write\`, \`fd_seek\`, \`fd_close\`, \`environ_get\`,
  \`environ_sizes_get\`, and \`strftime_l\` are **imports** implemented by musl-
  derived JS shims in \`heic_dec.js\`, not musl object code compiled into the
  WASM. Whether additional, higher-level musl libc logic is separately
  compiled *into* the WASM (as opposed to only these low-level primitives
  crossing to JS) is not confirmed either way from the stripped binary alone.
- \`__cxa_throw\` is an **import** — when the compiled code would throw a C++
  exception, it calls out to a JS-implemented throw path in \`heic_dec.js\`
  rather than running native WASM unwinding. This is evidence of a call
  site, not evidence that libc++abi's exception-unwinding machinery is
  compiled into the WASM.

By contrast, some libc++abi functions genuinely ARE compiled into and
**exported by** the WASM (\`___cxa_is_pointer_type\`, \`___getTypeName\`,
\`__cxa_increment_exception_refcount\`), and C++ RTTI \`type_info\`/
\`std::string\`-family mangled-name strings appear directly in the WASM's own
data — that is direct evidence of libc++abi object code compiled in, not
merely imported.

The practical consequence: **the final distributed artifact this package
documents is the \`heic_dec.js\` + \`heic_dec.wasm\` pair together**, not the
WASM in isolation. A description of "what's in the WASM" that ignores
\`heic_dec.js\`'s generated runtime support is incomplete. See
\`SOURCE-METADATA.json\`'s \`emscriptenComponents\` field for the full,
evidence-graded breakdown (confirmed-as-import vs. confirmed-as-internal vs.
unconfirmed) this section summarizes.

## Application code candidates

This package does not assert that Corresponding Application Code is limited
to \`heic_dec.cpp\`. What the technical record actually shows:

**Relationship to libheif**: \`heic_dec.cpp\` includes libheif's headers and
calls its C API directly via embind — the clearest single candidate. But
jSquash's \`Makefile\`, \`pre.js\`, and the compiler/linker settings recorded
in \`SOURCE-METADATA.json\` are also part of what determines the final
Combined Work, since they control how \`heic_dec.cpp\` is actually combined
with libheif into one WASM. FileFit's own
\`heic-convert.worker.ts\` (below) is not a build input for any of this — it
plays no role in compiling or linking the WASM.

**Relationship to libde265**: libheif uses libde265 as its HEVC decoder
plugin (\`libheif/plugins/decoder_libde265.cc\`), not \`heic_dec.cpp\`
directly. Recombining a modified libde265 into a working WASM therefore
depends on libheif's own source (the plugin glue code), not only on
libde265's source in isolation — which is why this package includes **both**
upstream archives (\`upstream/libheif-*.tar.gz\` and
\`upstream/libde265-*.tar.gz\`) rather than only libde265's. See "libde265
relinking" below for a demonstrated rebuild against a modified libde265,
analogous to the existing libheif demonstration.

**This is not a final determination of Application Code's legal scope.**
Both relationships above are recorded as technical facts about how the
Combined Work is actually built, not as a legal conclusion about what LGPL
requires FileFit to provide as Corresponding Application Code.

Conservatively, this package additionally includes FileFit's own
\`heic-convert.worker.ts\` as \`application-code-candidates/heic-convert.worker.ts\`:

- It is a **runtime integration example**, showing how FileFit's own code
  calls the published \`decode()\` function through the WASM's public
  interface (via \`@discourse/heic/decode\`).
- It is **not a WASM compilation or linking input** — nothing in
  \`jsquash/packages/heic/codec/Makefile\` reads, references, or links
  against it, and \`rebuild.sh\` never touches it.
- Including it here is **not a determination that it is legally required
  Corresponding Application Code** — that determination is not conclusively
  resolved here, same as for \`heic_dec.cpp\` (see "Remaining legal
  interpretation risks"). It is included as a conservative candidate for
  side-by-side review, not because its inclusion has been concluded to be
  necessary.
- The scope-limited MIT grant in \`licenses/mit-filefit-relink-support.txt\`
  applies only to **this package's copy** of the file
  (\`application-code-candidates/heic-convert.worker.ts\`, as distributed
  inside this specific \`.tar.gz\`). It does **not** change the license status
  of FileFit's own repository copy at
  \`src/components/image-intake/heic-convert.worker.ts\`, and does not apply
  to any other FileFit code, UI, or feature.

\`application-code-candidates/heic_dec.cpp\` is an **intentional, identical
copy** of \`jsquash/packages/heic/codec/dec/heic_dec.cpp\` — the same file
appears in both locations on purpose (one copy in its original upstream
location, one copy alongside the other Application Code candidate for easy
side-by-side review), not two independently-maintained versions.
\`jsquash/packages/heic/codec/dec/heic_dec.cpp\` is the source of truth; see
\`SOURCE-METADATA.json\`'s \`applicationCodeCandidateIntegrity\` field for both
files' SHA-256. Both this package's build script and
\`scripts/verify-lgpl-heic-source-package.mjs\` (in the FileFit repository)
fail if the two ever diverge.

## Emscripten and system runtime support

\`heic_dec.js\` (generated by Emscripten 3.1.57) contains Emscripten's own
runtime support code, plus the JS-side implementations of several functions
Production \`heic_dec.wasm\` imports (see "What a WASM import does and does
not prove" above). None of this is FileFit's or jSquash's own code:

- **Emscripten runtime, embind, and emval**: MIT / University of Illinois-
  NCSA (dual-licensed), copyright the Emscripten Authors. Reference text:
  \`licenses/mit-emscripten.txt\` (Emscripten 3.1.57's exact root \`LICENSE\`).
- **musl libc** (the syscall-primitive imports listed above): MIT, copyright
  the musl libc project. Reference text: \`licenses/mit-musl.txt\` (musl's own
  \`COPYRIGHT\` file from the exact Emscripten 3.1.57 tag).
- **libc++ / libc++abi** (confirmed compiled into Production \`heic_dec.wasm\`
  itself — see "What a WASM import does and does not prove" above):
  Apache License 2.0 WITH LLVM Exceptions, copyright the LLVM Project.
  compiler-rt / libunwind remain toolchain-default candidates whose presence
  in the final WASM is **not confirmed**. Reference text:
  \`licenses/apache-2.0-llvm-exception.txt\` (the LLVM Project's exact
  \`LICENSE.TXT\` from Emscripten 3.1.57's \`system/lib/libcxx/\`). That file's
  own LLVM Exception text states that Object-form embedding resulting from
  compiling this software does not require complying with License sections
  4(a), 4(b), and 4(d) — recorded here verbatim rather than summarized.

**This package does not include Emscripten's own source.** The reasoning —
not a legal conclusion, but the technical basis for why it isn't included —
is that GPLv3 §1's "System Libraries" definition excludes "a compiler used
to produce the work" and its normal packaging from Corresponding Source, and
LGPLv3 §0 separately excludes "System Libraries" from Corresponding
Application Code. Emscripten (the compiler/toolchain used to produce this
WASM) and its bundled runtime support are treated here as falling under that
exclusion. **Whether this exclusion is legally sufficient specifically for
FileFit's distribution is not asserted or determined by this package** — it
is recorded as the reasoning behind a packaging decision, not as a
compliance conclusion.

## libde265 relinking

In addition to the libheif relinking procedure demonstrated in PR #12 and
documented in \`BUILD.md\`/\`REPLACE-WASM.md\`, this package's \`rebuild.sh\`
supports an analogous \`modified-libde265\` mode: it patches libde265's own
version string (\`libde265/libde265/de265-version.h.in\`, the
\`LIBDE265_VERSION\` macro — the file libheif's plugin code reads via
\`de265_get_version()\`) with a marker, rebuilds, and the marker string
becomes visible in the resulting WASM via \`strings\`. See \`BUILD.md\` for the
full procedure and \`REPLACE-WASM.md\`/\`SOURCE-METADATA.json\` for the
verified results (baseline vs. modified-libheif vs. modified-libde265: WASM
SHA-256, size, import/export counts, and whether the JS glue stayed
byte-identical).

\`rebuild.sh\` no longer accepts an arbitrary \`--patch <path>\` argument for
this. Each of \`modified-libheif\` and \`modified-libde265\` patches one
specific, hardcoded, pre-reviewed file — there is no generic "patch any file
under \`node_modules/\`" mode.

## Package-specific file licensing

Most files in this package come from an upstream project (jSquash, libheif,
libde265, Emscripten) and carry that project's own license — see
\`LICENSE-MAP.md\`. The handful of files FileFit itself authored specifically
for this package (\`README.md\`, \`BUILD.md\`, \`REPLACE-WASM.md\`,
\`LICENSE-MAP.md\`, \`Dockerfile\`, \`rebuild.sh\`, \`verify.mjs\`,
\`SOURCE-METADATA.json\`, and this package's copy of
\`application-code-candidates/heic-convert.worker.ts\`) are licensed under a
narrow, package-scoped MIT grant —
\`licenses/mit-filefit-relink-support.txt\` — that applies **only to those
files as distributed inside this package**. It does not apply to FileFit's
repository as a whole, FileFit's UI, other FileFit image-processing
features, FileFit's site design, or (for the worker specifically) FileFit's
own repository copy of that file.

## File Fit's own code license status

FileFit's own source code (including its repository copy of
\`heic-convert.worker.ts\`, distinct from this package's copy above) does not
currently carry an explicit license header or declared license for its
application code, and this README does not add one on FileFit's behalf.

## Version and update history

This package corresponds to \`@discourse/heic@${PINNED.discourseHeicVersion}\`
only, which FileFit's \`package.json\` now pins exactly (not as a \`^\` range)
specifically so this correspondence cannot silently drift. If FileFit's HEIC
dependency changes version in the future, this package must be regenerated
(see \`scripts/build-lgpl-heic-source-package.mjs\` in the FileFit repository,
which refuses to run if the installed version, lockfile entry, npm
integrity, or any wrapper/WASM file hash has drifted from what is pinned)
and re-published under a new version-numbered filename; it is not
automatically kept in sync.

## Source retention policy

- While FileFit serves a given Production \`heic_dec.wasm\` over the network,
  the corresponding version-named source package (this file, or its
  successor) is kept available at no charge, at the same origin as the WASM
  itself (currently: FileFit's own site, under \`/source/\`).
- When the \`@discourse/heic\` dependency version changes, a new,
  version-named package is published rather than overwriting this one in
  place.
- If an older Production WASM remains reachable by any means (e.g. a cached
  deployment, a prior release), the corresponding older source package is
  also kept available, not deleted once superseded.
- This repository's file at \`public/source/filefit-heic-decoder-1.0.0-source.tar.gz\`
  (served at \`/source/filefit-heic-decoder-1.0.0-source.tar.gz\`) is treated
  as the canonical distribution location. A GitHub Actions workflow artifact
  (which expires automatically) is not relied on as the primary or sole
  distribution point for this package.
- The package's filename, SHA-256, and size are recorded in
  \`THIRD_PARTY_NOTICES.md\`, \`/licenses\` on FileFit's site, and this
  package's own \`SOURCE-METADATA.json\`, and are updated together whenever
  the package is regenerated.

This describes an operating policy, not a legal conclusion about how long
retention is required, or about what form of access is legally sufficient —
see "Remaining legal interpretation risks" above.
`;
}

function buildBuildMd() {
  return `# BUILD.md — rebuilding the HEIC decoder WASM from this package

These are the exact steps used in [PR #12](https://github.com/Sotaro-Kato443/filefit/pull/12)
and [PR #13](https://github.com/Sotaro-Kato443/filefit/pull/13)'s package-rebuild
verification workflow. **This package is the only source input** — \`./rebuild.sh\`
never fetches jSquash, libheif, or libde265 over the network; everything it
reads comes from \`jsquash/\` and \`upstream/\` inside this package.

That said, this is **not a claim of a fully air-gapped build environment**.
Getting to the point where you can run \`rebuild.sh\` still needs network
access for two things that are outside this package's control: pulling the
pinned Docker image, and installing the OS packages (\`autoconf\`, \`libtool\`,
\`pkg-config\`) the build needs via \`apt-get\`. The accurate description is:
**once a Docker environment with the required build dependencies is ready,
rebuilding needs no further network access to fetch upstream source.**

## Required environment

- Docker, able to run
  \`${PINNED.dockerImage}@${PINNED.dockerImageDigest}\`
  (pinned by digest, not just tag; confirmed to resolve to a single-platform
  linux/amd64 manifest — see \`SOURCE-METADATA.json\`).
- Network access for the Docker image pull and \`apt-get install\` step below.
  No network access is needed after that.

## 1. Check Docker is available

\`\`\`bash
docker version
\`\`\`

## 2. Extract this package (if you have not already)

\`\`\`bash
tar xzf filefit-heic-decoder-1.0.0-source.tar.gz
cd filefit-heic-decoder-1.0.0-source
sha256sum -c SHA256SUMS   # optional but recommended
\`\`\`

## 3. Baseline build (unmodified sources)

Build a local image from this package's own \`Dockerfile\` (network required —
it pulls the pinned base image and \`apt-get install\`s \`autoconf\`/\`libtool\`/
\`pkg-config\` into that image), then run the actual source build from that
image with no network access at all:

\`\`\`bash
docker build -t filefit-heic-source-build:local .

docker run --rm --network=none -v "$PWD":/work -w /work \\
  filefit-heic-source-build:local \\
  ./rebuild.sh baseline
\`\`\`

(\`docker build\` is the network-connected step — it resolves the pinned
\`${PINNED.dockerImage}@${PINNED.dockerImageDigest}\` base image and installs
build dependencies into a new local image layer. Once that image exists,
every \`docker run --network=none ... filefit-heic-source-build:local\`
against it has the dependencies already baked in, so the source build itself
never touches the network. This is the same two-phase structure —
network-connected image preparation, then network-isolated source build —
used by \`verify-lgpl-heic-source-rebuild.yml\` in the FileFit repository,
which builds an equivalent temporary verification image before running
\`--network=none\` against it. That temporary image is local/CI-only and is
never pushed to a public registry; the same applies to the
\`filefit-heic-source-build:local\` image you build here.)

\`./rebuild.sh baseline\` extracts \`upstream/${PINNED.libheifArchiveName}\` and
\`upstream/${PINNED.libde265ArchiveName}\` locally (no network fetch), builds
both as static libraries with the same CMake flags as upstream's own
\`Makefile\` (\`jsquash/packages/heic/codec/Makefile\`, included in this
package: encoder disabled, x265/AOM/dav1d/rav1e/SvtEnc/Kvazaar/OpenJPEG/JPEG/
OpenH264/FFmpeg all explicitly \`OFF\`), then links
\`jsquash/packages/heic/codec/dec/heic_dec.cpp\` against them with:

\`\`\`
-Oz -flto -std=c++17 --bind -s EXPORT_ES6=1 -s MODULARIZE=1 -s ENVIRONMENT=web,worker
\`\`\`

## 4. Output location

\`\`\`
out/baseline/heic_dec.wasm
out/baseline/heic_dec.js
\`\`\`

## 5. Verify against Production

\`\`\`bash
sha256sum out/baseline/heic_dec.wasm out/baseline/heic_dec.js
\`\`\`

Expected (from \`SOURCE-METADATA.json\` / the successful PR #12 run):

\`\`\`
${PINNED.prodWasmSha256}  heic_dec.wasm
${PINNED.prodJsSha256}  heic_dec.js
\`\`\`

If these do not match, do not assume the rebuild is wrong before checking
toolchain/version drift — see PR #12's report for a discussion of what can
cause byte-level differences (LTO, timestamps, packaging).

## 6. Check import/export shape

\`\`\`bash
node verify.mjs out/baseline/heic_dec.wasm
\`\`\`

Prints import/export counts and custom-section presence (no dedicated tool
required; uses Node's built-in \`WebAssembly\` API only, matching PR #12's
approach). Expected for this exact build: 41 imports, 16 exports, no
\`name\`/\`producers\`/\`sourceMappingURL\` custom sections.

## 7. Relink against a modified library

\`rebuild.sh\` has three modes: \`baseline\` (step 3, above), \`modified-libheif\`,
and \`modified-libde265\`. There is no generic \`--patch <any-path>\` option —
each \`modified-*\` mode patches one specific, hardcoded, pre-reviewed file.
This is deliberate: a prior version of this script accepted an arbitrary
path under \`node_modules/\`, which was more general than necessary and
harder to review for safety. The two modes below cover the two upstream
libraries this package can currently demonstrate a relink against.

### 7a. Relink against a modified libheif

\`\`\`bash
docker run --rm --network=none -v "$PWD":/work -w /work \\
  filefit-heic-source-build:local \\
  ./rebuild.sh modified-libheif --marker your-marker-here
\`\`\`

Patches \`node_modules/libheif/libheif/api/libheif/heif_version.h.in\`'s
\`LIBHEIF_VERSION\` macro (the \`@PROJECT_VERSION_PATCH@"\` pattern), appending
\`-<marker>\`. The doubled \`libheif/libheif/...\` segment is not a typo: the
Makefile's \`CODEC_DIR\` (\`node_modules/libheif\`) is the extraction target
for the upstream libheif release archive, and that archive's own top level
(after the version-tag directory is stripped) already contains a
\`libheif/\` subdirectory before \`api/libheif/heif_version.h.in\`. PR #12's
own experiment patched this same file — see \`REPLACE-WASM.md\` for why it
was chosen.

### 7b. Relink against a modified libde265

\`\`\`bash
docker run --rm --network=none -v "$PWD":/work -w /work \\
  filefit-heic-source-build:local \\
  ./rebuild.sh modified-libde265 --marker your-marker-here
\`\`\`

Patches \`node_modules/libde265/libde265/de265-version.h.in\`'s
\`LIBDE265_VERSION\` macro (the \`@PACKAGE_VERSION@"\` pattern), appending
\`-<marker>\`. Same doubled-path reasoning as libheif above: libde265's
upstream release archive's own top level, after the version-tag directory is
stripped, already contains a \`libde265/\` subdirectory before
\`libde265/de265-version.h.in\`. This file is CMake-\`configure_file()\`'d into
\`de265-version.h\` at build time, and the resulting \`LIBDE265_VERSION\`
string is what \`de265_get_version()\` returns — a function libheif calls, so
the marker ends up reachable from the linked WASM the same way libheif's own
version string does.

For either mode, \`--marker\` takes the raw marker text with no leading
hyphen (\`rebuild.sh\` inserts the \`-\` separator itself) and is restricted to
\`[A-Za-z0-9_-]\` — anything else is rejected before it reaches \`sed\`.
\`rebuild.sh modified-libheif\`/\`modified-libde265\` extracts a fresh copy of
both libheif and libde265 from this package's own \`upstream/\` archives
(independent of any \`baseline\` run), verifies the exact substitution
pattern appears in the target file exactly once (refusing to proceed if it
is missing or ambiguous), and verifies the target path resolves inside the
expected extracted directory (rejecting a symlink escape, as defense in
depth even though the path itself is no longer attacker-influenced).

## 8. Confirm the modification is present

\`\`\`bash
strings -n 6 out/modified-libheif/heic_dec.wasm | grep -i "your-marker-here"
strings -n 6 out/modified-libde265/heic_dec.wasm | grep -i "your-marker-here"
\`\`\`

## 9. Invalid-input smoke test (NOT a real decode test)

\`\`\`bash
node verify.mjs --smoke-test out/modified-libheif/heic_dec.js
node verify.mjs --smoke-test out/modified-libde265/heic_dec.js
\`\`\`

This confirms the module instantiates in Node, its embind \`decode()\` binding
is callable, and it rejects a deliberately invalid buffer by returning
\`null\` without throwing — exactly what PR #12's own smoke test checked, no
more. **It does not decode a real HEIC image.**

## 10. What is still unverified after these steps

Real HEIC decode correctness on actual photo data. No HEIC fixture with a
clear redistribution license is included in this package or FileFit's
repository (see the "real HEIC fixture" note in PR #13). Before relying on a
rebuilt or relinked WASM for anything beyond this technical demonstration,
verify it against real, representative HEIC files under your own testing
process.
`;
}

function buildReplaceWasmMd() {
  return `# REPLACE-WASM.md — swapping in a rebuilt/relinked WASM

This describes a **technically demonstrated procedure** (PR #12, run
[30613638427](https://github.com/Sotaro-Kato443/filefit/actions/runs/30613638427)),
not a legally-reviewed "sufficient" corresponding-source remedy. Whether this
satisfies LGPL's relinking requirements is not conclusively determined here
— see \`README.md\`'s "Remaining legal interpretation risks".

## Where the WASM lives today

- **Production npm package** (\`@discourse/heic@${PINNED.discourseHeicVersion}\`):
  \`node_modules/@discourse/heic/codec/dec/heic_dec.wasm\` and the sibling
  \`heic_dec.js\` glue file.
- **FileFit's build**: Vite/Astro bundles \`@discourse/heic/decode\`
  (\`src/components/image-intake/heic-convert.worker.ts\` is the only FileFit
  code that imports it), which re-exports the same \`decode.js\` →
  \`utils.js\`/\`codec/pre.js\` → \`codec/dec/heic_dec.js\` chain shipped inside
  the npm package. FileFit does not fork, vendor, or modify any of these
  files (confirmed during the PR #12 audit).

## The key technical fact this package is built to support

PR #12's \`verify\` job compared the JS glue file produced by a baseline
rebuild against the JS glue file produced after relinking against a
source-modified libheif, and found them **byte-identical**. This package
additionally demonstrates the same result for a source-modified libde265
(\`rebuild.sh modified-libde265\` — see \`BUILD.md\`; results recorded in
\`SOURCE-METADATA.json\`). Concretely, in both cases: only \`heic_dec.wasm\`
changed when the library was modified; \`heic_dec.js\` did not need to change
at all.

This means the *technical* mechanics of "use a relinked library" reduce to
replacing one file:

\`\`\`
node_modules/@discourse/heic/codec/dec/heic_dec.wasm   ← replace this file
node_modules/@discourse/heic/codec/dec/heic_dec.js      ← leave unchanged
\`\`\`

(or the equivalent path inside whatever bundling step copies these files into
FileFit's build output — this package does not itself change FileFit's build
configuration.)

## How to verify a WASM you built is a valid drop-in

1. **SHA-256 the file** — compare against the value your own rebuild reports,
   and/or against Production's recorded value
   (\`${PINNED.prodWasmSha256}\`) if you rebuilt *without* modification.
2. **Check the import/export shape matches** — run \`verify.mjs\` from this
   package against both the original and your rebuilt WASM. PR #12's
   baseline and modified builds both had 41 imports / 16 exports; a
   source-only change that doesn't alter the embind-exposed API surface
   should preserve this shape. A WASM with a different import/export shape
   is not a safe drop-in replacement — the JS glue's calling code assumes a
   specific ABI.
3. **Run the invalid-input smoke test** (\`verify.mjs --smoke-test\`) against
   the new WASM/JS pair together, to confirm the module still instantiates
   and the binding is still callable end-to-end.

## Local development check (not a Production change)

To try a locally-rebuilt WASM against FileFit's own dev server, replace the
file in a local \`node_modules/@discourse/heic/codec/dec/heic_dec.wasm\`
checkout and run \`npm run dev\`, then exercise the HEIC upload flow. **Do not
deploy this to Cloudflare Production** — that is a decision requiring its own
review, separate from this technical package.

## What this does not establish

- That this is the *only* correct way to satisfy relinking requirements.
- That WASM-only replacement is sufficient in every case — future libheif/
  libde265 changes could, in principle, alter the ABI in ways that also
  require JS glue changes; this package only reports what was true for the
  one modification tested in PR #12.
- Any conclusion about whether browser-delivered WASM constitutes "conveying"
  under LGPL terms, or whether this repository's public GitHub visibility is
  itself sufficient — both remain open interpretation questions, listed in
  \`README.md\`'s "Remaining legal interpretation risks".
`;
}

function buildSourceMetadata({
  heicDecCppSha,
  makefileSha,
  appCodeHeicDecCppSha,
  relinkResults = null,
}) {
  return (
    JSON.stringify(
      {
        _comment:
          "Self-reviewed technical and license source/relink package metadata, published based on " +
          "FileFit's own technical and license self-review. Not reviewed by external legal counsel. " +
          "Not legal advice. Not a compliance claim or a guarantee of legal sufficiency.",
        packageName: "filefit-heic-decoder-1.0.0-source",
        correspondsToNpmPackage: {
          name: "@discourse/heic",
          version: PINNED.discourseHeicVersion,
          pinnedExactly:
            'FileFit\'s package.json pins this as "1.0.0", not "^1.0.0" -- CI and this ' +
            "package's own build script both fail if the installed version, lockfile entry, " +
            "npm integrity, or any wrapper/WASM file hash drifts from what's recorded below.",
        },
        productionArtifacts: {
          "heic_dec.wasm": { sha256: PINNED.prodWasmSha256 },
          "heic_dec.js": { sha256: PINNED.prodJsSha256 },
        },
        discourseHeicWrapperFiles: {
          _comment:
            "SHA-256 of every file this package reads out of the installed " +
            "node_modules/@discourse/heic, pinned so a version-number-preserving republish " +
            "of the npm package is still detected.",
          integrity: PINNED.discourseHeicIntegrity,
          files: PINNED.discourseHeicWrapperSha256,
        },
        sources: {
          jsquash: {
            repository: "https://github.com/discourse/jSquash",
            exactCommit: PINNED.jsquashCommit,
            archiveUrl: PINNED.jsquashUrl,
            archiveSha256: PINNED.jsquashSha256,
            classification: "exact commit confirmed (see PR #12 audit)",
            packagedAs:
              "extracted source tree (jsquash/packages/heic/ + jsquash/tools/, in full -- every " +
              "file in both directories, not a hand-picked subset) under this package's jsquash/ " +
              "directory, NOT the raw commit archive. The full jSquash commit archive is a whole-" +
              "monorepo snapshot (~25MB compressed, ~39MB uncompressed) that would have pushed " +
              "this package over Cloudflare Pages' 25MiB single-asset limit for no benefit. " +
              "archiveSha256 above is what this package's build script fetched and verified " +
              "BEFORE extracting packages/heic/ and tools/ from it -- it authenticates the exact " +
              "commit even though the raw archive bytes are not embedded in this package.",
            excludedSiblingPackagesNote:
              "This same jSquash commit also contains packages/avif, jpeg, png, webp, jxl, jxr, " +
              "oxipng, qoi, resize, and gif -- separate codec packages that FileFit's HEIC build " +
              "never reads or links against (see packages/heic/codec/Makefile, included in this " +
              "package, which only ever touches packages/heic/ and tools/). Excluding them is NOT " +
              "a size-driven trim of HEIC-relevant source and is NOT a determination of LGPL's " +
              "'Minimal Corresponding Source' scope -- those packages were technically unconnected " +
              "to the HEIC WASM build regardless of any licensing question. What counts as " +
              "sufficient Corresponding Source for the HEIC decoder itself remains a legal-" +
              "interpretation question not conclusively resolved here (see legalStatus below and " +
              "README.md's 'Remaining legal interpretation risks').",
          },
          libheif: {
            repository: "https://github.com/strukturag/libheif",
            exactTag: PINNED.libheifTag,
            archiveUrl: PINNED.libheifUrl,
            archiveSha256: PINNED.libheifSha256,
            license: "LGPL-3.0 (library); MIT (sample apps/wrappers)",
            packagedAs: "raw archive, embedded unmodified at upstream/libheif-v1.19.7.tar.gz",
          },
          libde265: {
            repository: "https://github.com/strukturag/libde265",
            exactTag: PINNED.libde265Tag,
            archiveUrl: PINNED.libde265Url,
            archiveSha256: PINNED.libde265Sha256,
            license: "LGPL-3.0 (library); MIT (sample apps)",
            packagedAs: "raw archive, embedded unmodified at upstream/libde265-v1.0.15.tar.gz",
          },
        },
        keySourceFileHashes: {
          "jsquash/packages/heic/codec/dec/heic_dec.cpp": heicDecCppSha,
          "jsquash/packages/heic/codec/Makefile": makefileSha,
        },
        applicationCodeCandidateIntegrity: {
          _comment:
            "application-code-candidates/heic_dec.cpp is an intentional identical copy of " +
            "jsquash/packages/heic/codec/dec/heic_dec.cpp, not a separate/divergent file. Both " +
            "this package's build script and scripts/verify-lgpl-heic-source-package.mjs fail if " +
            "the two SHA-256 values below ever differ.",
          sourceOfTruthPath: "jsquash/packages/heic/codec/dec/heic_dec.cpp",
          applicationCodeCandidatePath: "application-code-candidates/heic_dec.cpp",
          sourceOfTruthSha256: heicDecCppSha,
          applicationCodeCandidateSha256: appCodeHeicDecCppSha,
          identical: heicDecCppSha === appCodeHeicDecCppSha,
        },
        toolchain: {
          dockerImage: PINNED.dockerImage,
          dockerImageDigest: PINNED.dockerImageDigest,
          dockerImageDigestNote:
            "Digest recorded at package-build time via the Docker Hub public API " +
            "(no local Docker required to record it). Tags can be repointed by the " +
            "image publisher; the digest is the stronger pin. Re-verify if rebuilding " +
            "far in the future.",
          emscriptenVersion: PINNED.emscriptenVersion,
          // Every flag actually set, split by which build step consumes it.
          // Source: jsquash/packages/heic/codec/Makefile (the $(OUT_DEC_JS)
          // rule's $(CXXFLAGS)/$(LDFLAGS) + literal em++ flags),
          // jsquash/packages/heic/codec/package.json ("build" script), and
          // this package's own Dockerfile/rebuild.sh (ENV CFLAGS/CXXFLAGS/
          // LDFLAGS, which mirror the Makefile's values exactly).
          compilerFlags: {
            cflags: ["-Oz", "-flto"],
            cxxflagsAdditional: ["-std=c++17"],
            note:
              "CXXFLAGS = CFLAGS + cxxflagsAdditional at build time (see Dockerfile/rebuild.sh " +
              '"ENV CXXFLAGS" line, which matches jsquash/packages/heic/codec/package.json\'s ' +
              "\"build\" script: EMSDK_VERSION=3.1.57 DEFAULT_CFLAGS='-Oz -flto').",
          },
          lto: {
            enabled: true,
            note:
              "-flto is set on CFLAGS (and therefore inherited by CXXFLAGS/LDFLAGS). This means " +
              "intermediate object files are LLVM bitcode, not directly relinkable without the " +
              "exact same Emscripten/LLVM toolchain version -- see README.md's source-only " +
              "discussion in PR #13 for why this package provides source rather than object/bitcode.",
          },
          includePaths: [
            "node_modules/libheif/libheif",
            "node_modules/libheif/libheif/api",
            "node_modules/build/libheif",
          ],
          directLinkInputs: {
            _comment:
              "The exact inputs to the final em++ invocation (jsquash/packages/heic/codec/" +
              'Makefile\'s $(OUT_DEC_JS) rule, "$(CXX) ... -o $@ $+" where $+ expands to these, ' +
              "in order).",
            inputs: [
              "dec/heic_dec.cpp",
              "node_modules/build/libheif/libheif/libheif.a (static archive, built via CMake from upstream/libheif-v1.19.7.tar.gz)",
              "node_modules/build/libde265/libde265/libde265.a (static archive, built via CMake from upstream/libde265-v1.0.15.tar.gz)",
            ],
          },
          emscriptenFlags: {
            _comment:
              "Every -s setting and every other emcc/em++ flag actually passed, not a summary subset.",
            bind: "--bind (enables embind)",
            preJs:
              '--pre-js pre.js (jSquash\'s pre.js is textually inserted into the generated JS -- see README.md "Emscripten and system runtime support")',
            settings: [
              "ERROR_ON_UNDEFINED_SYMBOLS=0",
              "ENVIRONMENT=web,worker",
              "EXPORT_ES6=1",
              "DYNAMIC_EXECUTION=0",
              "MODULARIZE=1",
              "STACK_SIZE=5242880",
              "INITIAL_MEMORY=16777216",
              "PTHREAD_POOL_SIZE=navigator.hardwareConcurrency",
              "FILESYSTEM=0",
              "ALLOW_MEMORY_GROWTH=1",
              "TEXTDECODER=0",
            ],
            pthreadPoolSizeNote:
              "PTHREAD_POOL_SIZE is set, but -pthread (equivalently -s PTHREADS=1 / the legacy " +
              "-s USE_PTHREADS=1) is NOT set anywhere in this build. Emscripten only enables " +
              "pthread support when -pthread is passed; PTHREAD_POOL_SIZE alone does not enable " +
              "it. This is confirmed by direct binary inspection of Production heic_dec.wasm: its " +
              'Memory section is not marked "shared", and its full disassembly contains zero ' +
              "WebAssembly threads/atomics-proposal opcodes. Do not describe this build as having " +
              "pthreads/multithreading enabled -- the flag is present but structurally inert.",
          },
        },
        // Evidence-graded breakdown of what's actually inside Production
        // heic_dec.wasm + heic_dec.js, referenced from README.md "What a
        // WASM import does and does not prove". Each entry's evidenceTier is
        // one of: "wasm-export" / "wasm-internal-symbol-or-string" (strong:
        // code is compiled INTO the wasm), "wasm-import" (the wasm calls OUT
        // to heic_dec.js for this -- evidence of a call site, not of an
        // internal implementation), or "unconfirmed" (no symbol, string, or
        // archive-member evidence found either way; toolchain-default
        // reasoning only).
        emscriptenComponents: {
          embindRegistration: {
            license: "MIT / University of Illinois-NCSA (dual)",
            copyrightHolder: "The Emscripten Authors",
            evidenceTier: "wasm-import",
            detail:
              "16 distinct __embind_register_*/__embind_finalize_value_object functions are " +
              "imports of Production heic_dec.wasm, implemented in heic_dec.js's generated " +
              "runtime -- NOT compiled into the WASM itself. The C++ code that decides what to " +
              "register (from heic_dec.cpp + Emscripten's embind headers) is compiled into the " +
              "WASM as unnamed internal functions (no name-section evidence survives).",
          },
          emval: {
            license: "MIT / University of Illinois-NCSA (dual)",
            copyrightHolder: "The Emscripten Authors",
            evidenceTier: "wasm-import",
            detail:
              "11 distinct __emval_* functions are imports, same reasoning as embindRegistration above.",
          },
          muslSyscallPrimitives: {
            license: "MIT",
            copyrightHolder: "musl libc project (Rich Felker et al.)",
            evidenceTier: "wasm-import",
            detail:
              "__syscall_openat, __syscall_getdents64, __syscall_unlinkat, fd_read, fd_write, " +
              "fd_seek, fd_close, environ_get, environ_sizes_get, strftime_l are imports, " +
              "implemented by musl-derived JS shims in heic_dec.js. openat/getdents64 correspond " +
              "to libheif's own opendir()/readdir()/dlopen() plugin-directory-scan code " +
              "(libheif/plugins_unix.cc, LIBHEIF_PLUGIN_PATH) -- confirmed by reading that source " +
              "file. unlinkat's exact call site is not identified.",
          },
          higherLevelMuslLibc: {
            license: "MIT",
            copyrightHolder: "musl libc project (Rich Felker et al.)",
            evidenceTier: "unconfirmed",
            detail:
              "Whether musl's higher-level C functions (e.g. the bodies of opendir()/readdir(), " +
              "as opposed to only the raw syscalls above) are separately compiled INTO the WASM " +
              "is not confirmed -- the stripped binary retains no name-section evidence either way.",
          },
          cxaThrow: {
            evidenceTier: "wasm-import",
            detail:
              "__cxa_throw is an import -- the WASM calls out to a JS-implemented throw path in " +
              "heic_dec.js rather than running native WASM exception unwinding. Evidence of a " +
              "call site only, not of libc++abi's exception-unwinding machinery being compiled " +
              "into the WASM.",
          },
          libcxxAbiRtti: {
            license: "Apache License 2.0 WITH LLVM Exceptions",
            copyrightHolder: "The LLVM Project",
            evidenceTier: "wasm-export",
            detail:
              "___cxa_is_pointer_type, ___getTypeName, and __cxa_increment_exception_refcount are " +
              "EXPORTS of Production heic_dec.wasm (the WASM implements and exposes them), and " +
              "__cxxabiv1 type_info / std::string-family mangled-name strings appear directly in " +
              "the WASM's own data. This is direct evidence of libc++abi object code compiled " +
              "into the WASM, distinct from the merely-imported __cxa_throw above.",
          },
          compilerRt: {
            license: "Apache License 2.0 WITH LLVM Exceptions (if present)",
            copyrightHolder: "The LLVM Project",
            evidenceTier: "unconfirmed",
            detail:
              "Toolchain-default candidate only (wasm32 LTO builds can require compiler-rt " +
              "builtins for some integer/float operations). No symbol, string, or archive-member " +
              "evidence was found in the stripped WASM either way.",
          },
          libunwind: {
            license: "Apache License 2.0 WITH LLVM Exceptions (if present)",
            copyrightHolder: "The LLVM Project",
            evidenceTier: "unconfirmed",
            detail:
              "No libunwind-specific symbols (e.g. _Unwind_RaiseException, _Unwind_Resume) were " +
              "found. DISABLE_EXCEPTION_CATCHING=1 (Emscripten 3.1.57's own default; not " +
              "overridden by this build) makes native unwinding unlikely to be needed, but this " +
              "is reasoning, not direct evidence of absence.",
          },
          dlmalloc: {
            license: "CC0 1.0 (public domain), Doug Lea, dlmalloc version 2.8.6",
            evidenceTier: "unconfirmed",
            detail:
              'Emscripten 3.1.57\'s default MALLOC setting is "dlmalloc" and this build does not ' +
              "override it, so dlmalloc is the toolchain-default candidate allocator. _malloc/" +
              "_free are confirmed WASM exports, but no symbol evidence distinguishes dlmalloc " +
              "from emmalloc internally.",
          },
          emscriptenSourceIncluded: false,
          emscriptenSourceExclusionReasoning:
            "Not included in this package. Reasoning (not a legal conclusion; see README.md " +
            '"Emscripten and system runtime support"): GPLv3 §1\'s System Libraries definition ' +
            'excludes "a compiler used to produce the work" and its normal packaging from ' +
            "Corresponding Source, and LGPLv3 §0 separately excludes System Libraries from " +
            "Corresponding Application Code. Whether this exclusion is legally sufficient for " +
            "FileFit's specific distribution is not asserted here.",
        },
        libheifCmakeFlags: [
          "-DCMAKE_BUILD_TYPE=Release",
          "-DBUILD_SHARED_LIBS=OFF",
          "-DWITH_EXAMPLES=OFF",
          "-DWITH_GDK_PIXBUF=OFF",
          "-DENABLE_MULTITHREADING_SUPPORT=OFF",
          "-DWITH_AOM_DECODER=OFF",
          "-DWITH_AOM_ENCODER=OFF",
          "-DWITH_X265=OFF",
          "-DWITH_DAV1D=OFF",
          "-DWITH_RAV1E=OFF",
          "-DWITH_SvtEnc=OFF",
          "-DWITH_KVAZAAR=OFF",
          "-DWITH_OpenJPEG_DECODER=OFF",
          "-DWITH_OpenJPEG_ENCODER=OFF",
          "-DWITH_JPEG_DECODER=OFF",
          "-DWITH_JPEG_ENCODER=OFF",
          "-DWITH_OpenH264_DECODER=OFF",
          "-DWITH_OpenH264_ENCODER=OFF",
          "-DWITH_FFMPEG_DECODER=OFF",
          "-DWITH_UNCOMPRESSED_CODEC=OFF",
          "-DWITH_DEFLATE_HEADER_COMPRESSION=OFF",
          "-DBUILD_TESTING=OFF",
          "-DWITH_LIBDE265=ON",
        ],
        libheifCmakeFlagsNote:
          "-DWITH_DEFLATE_HEADER_COMPRESSION=OFF has no effect (libheif v1.19.7's own CMakeLists.txt " +
          'does not define a variable by that exact name -- it emits a CMake "Manually-specified ' +
          'variables were not used by the project" warning). This does not enable zlib/Brotli: the ' +
          "actual gating variable is WITH_HEADER_COMPRESSION, which defaults OFF in libheif's own " +
          "CMakeLists.txt regardless of this flag, and WITH_UNCOMPRESSED_CODEC=OFF above closes the " +
          "other half of the same find_package(ZLIB)/find_package(Brotli) gate. Neither zlib nor " +
          "Brotli is linked into Production heic_dec.wasm.",
        libde265CmakeFlags: [
          "-DCMAKE_BUILD_TYPE=Release",
          "-DBUILD_SHARED_LIBS=OFF",
          "-DENABLE_SDL=OFF",
          "-DENABLE_ENCODER=OFF",
          "-DENABLE_DECODER=ON",
        ],
        prebuiltReferenceArtifacts: {
          _comment:
            "jSquash's own committed tree includes a prebuilt heic_dec.wasm/heic_dec.js under " +
            "packages/heic/codec/dec/ -- this package is not source-only in the sense of " +
            'containing zero object code. See README.md "This package is not source-only".',
          "jsquash/packages/heic/codec/dec/heic_dec.wasm": {
            sha256: PINNED.prodWasmSha256,
            usedAsRebuildInput: false,
            note: "rebuild.sh deletes this file from its working copy before invoking the source build.",
          },
          "jsquash/packages/heic/codec/dec/heic_dec.js": {
            sha256: PINNED.prodJsSha256,
            usedAsRebuildInput: false,
            note: "rebuild.sh deletes this file from its working copy before invoking the source build.",
          },
        },
        relinkResults: relinkResults ?? {
          _comment:
            "Populated from an actual Docker-based rebuild.sh run (see .github/workflows/" +
            'verify-lgpl-heic-source-rebuild.yml). Left as "pending" here if this package was ' +
            "regenerated in an environment without Docker available -- check the referenced " +
            "workflow run for authoritative values before relying on this section.",
          status: "pending",
        },
        archiveShaStabilityNote:
          "GitHub auto-generates tag/commit archives on demand; their exact bytes are " +
          "not guaranteed stable forever, even though the underlying commit/tag content " +
          "is. The archiveSha256 values above are what FileFit fetched and verified when " +
          "this package was built and should be treated as the authoritative reference " +
          "going forward, not re-derived from a live GitHub fetch each time.",
        provenance: {
          builtFromPullRequest: "https://github.com/Sotaro-Kato443/filefit/pull/12",
          demonstratedInRun: "https://github.com/Sotaro-Kato443/filefit/actions/runs/30613638427",
          generatedBy: "scripts/build-lgpl-heic-source-package.mjs",
        },
        legalStatus: {
          _comment:
            "This package is published based on FileFit's own technical and license self-review. " +
            "External legal counsel has not reviewed it. Publishing it does not mean every disputed " +
            "interpretation of LGPL requirements is conclusively resolved -- see README.md's " +
            "'Remaining legal interpretation risks'.",
          complianceAsserted: false,
          externalLegalReviewPerformed: false,
          externalLegalReviewRequiredForPublication: false,
          publishedBasedOnSelfReview: true,
          legalAdviceProvided: false,
          legalSufficiencyGuaranteed: false,
          realHeicDecodeVerified: false,
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function buildDockerfile() {
  return `# Rebuild environment for this package. Matches upstream jSquash's own
# tools/cpp.Dockerfile (included in jsquash/tools/cpp.Dockerfile) as used in
# PR #12's successful run. Pinned by tag and digest — see SOURCE-METADATA.json.
FROM ${PINNED.dockerImage}@${PINNED.dockerImageDigest}

ARG DEFAULT_CFLAGS="-Oz -flto"
ARG DEFAULT_CXX_FLAGS="-std=c++17"
ARG DEFAULT_EMSCRIPTEN_SETTINGS="\\
-s PTHREAD_POOL_SIZE=navigator.hardwareConcurrency \\
-s FILESYSTEM=0 \\
-s ALLOW_MEMORY_GROWTH=1 \\
-s TEXTDECODER=0 \\
"

RUN apt-get update -qq && apt-get install -qqy autoconf libtool pkg-config

ENV CFLAGS="\${DEFAULT_CFLAGS}"
ENV CXXFLAGS="\${CFLAGS} \${DEFAULT_CXX_FLAGS}"
ENV LDFLAGS="\${CFLAGS} \${DEFAULT_EMSCRIPTEN_SETTINGS}"

WORKDIR /src
`;
}

function buildRebuildSh() {
  return `#!/bin/bash
# Real, executable rebuild driver for this package. Run this INSIDE the
# pinned Docker image (see BUILD.md) -- it needs emcc/em++/emcmake/emmake on
# PATH and does not install Emscripten itself.
#
# Usage:
#   ./rebuild.sh baseline
#   ./rebuild.sh modified-libheif  --marker your-marker-here
#   ./rebuild.sh modified-libde265 --marker your-marker-here
#
# There is no generic "--patch <any-path>" mode. modified-libheif and
# modified-libde265 each patch one specific, hardcoded file (libheif's or
# libde265's own version-string header) -- narrower than a prior version of
# this script, which accepted an arbitrary path under node_modules/ and was
# harder to review for safety.
#
# Uses ONLY this package's own jsquash/ tree and upstream/*.tar.gz archives.
# Never fetches anything over the network -- safe to run with no network
# access at all (e.g. \`docker run --network=none\`), as long as the image
# already has emcc/em++/cmake and (for baseline builds only, since this
# script itself never invokes apt) any OS packages the Makefile's own build
# step needs are already installed.
set -euo pipefail
cd "$(dirname "$0")"
PACKAGE_ROOT="$PWD"

MODE="baseline"
MARKER=""
while [ $# -gt 0 ]; do
  case "$1" in
    baseline|modified-libheif|modified-libde265)
      MODE="$1"
      shift
      ;;
    --marker)
      MARKER="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ "$MODE" != "baseline" ]; then
  if [ -z "$MARKER" ]; then
    echo "mode=$MODE requires --marker <string>" >&2
    exit 1
  fi
  # Marker text is embedded into a sed replacement below. Restrict it to a
  # safe character set up front so it can never be interpreted as sed
  # syntax (a "/", "&", or backslash in an unvalidated marker could alter
  # what sed actually replaces).
  case "$MARKER" in
    *[!A-Za-z0-9_-]*)
      echo "invalid --marker: only [A-Za-z0-9_-] characters are allowed: $MARKER" >&2
      exit 1
      ;;
  esac
fi

export CFLAGS="-Oz -flto"
export CXXFLAGS="$CFLAGS -std=c++17"
export LDFLAGS="$CFLAGS -s PTHREAD_POOL_SIZE=navigator.hardwareConcurrency -s FILESYSTEM=0 -s ALLOW_MEMORY_GROWTH=1 -s TEXTDECODER=0"

WORK_DIR="$(mktemp -d "\${TMPDIR:-/tmp}/filefit-heic-rebuild-$MODE-XXXXXX")"
echo "Working directory: $WORK_DIR"
cp -R jsquash/packages/heic/codec "$WORK_DIR/codec"
mkdir -p "$WORK_DIR/codec/node_modules"
cp upstream/${PINNED.libheifArchiveName} "$WORK_DIR/codec/node_modules/libheif.tar.gz"
cp upstream/${PINNED.libde265ArchiveName} "$WORK_DIR/codec/node_modules/libde265.tar.gz"

cd "$WORK_DIR/codec"

# jsquash/packages/heic/codec/dec/ ships a prebuilt reference heic_dec.js/
# heic_dec.wasm as part of jSquash's own committed tree (see README.md
# "This package is not source-only"). Delete both here, before the source
# build runs, so this rebuild can only succeed by actually regenerating them
# from heic_dec.cpp + the two upstream libraries below -- never by silently
# reusing or copying the pre-existing files.
rm -f dec/heic_dec.js dec/heic_dec.wasm

# Materialize source only (extracts the two archives we just placed --
# the Makefile's own targets for this only run if node_modules/libheif.tar.gz
# / node_modules/libde265.tar.gz already exist, which they now do, so this
# never reaches the Makefile's curl-based download rules).
emmake make node_modules/libheif/CMakeLists.txt node_modules/libde265/CMakeLists.txt

if [ "$MODE" != "baseline" ]; then
  case "$MODE" in
    modified-libheif)
      # Doubled libheif/libheif/... segment is not a typo -- see BUILD.md.
      TARGET="node_modules/libheif/libheif/api/libheif/heif_version.h.in"
      ALLOWED_ROOT="node_modules/libheif"
      PATCH_PATTERN='@PROJECT_VERSION_PATCH@"'
      ;;
    modified-libde265)
      # Same doubled-path reasoning as libheif, for the same structural
      # reason (libde265's release archive's own top level also contains a
      # libde265/ subdirectory) -- see BUILD.md.
      TARGET="node_modules/libde265/libde265/de265-version.h.in"
      ALLOWED_ROOT="node_modules/libde265"
      PATCH_PATTERN='@PACKAGE_VERSION@"'
      ;;
  esac

  if [ -L "$TARGET" ]; then
    echo "invalid patch target: is a symlink, refusing: $TARGET" >&2
    exit 1
  fi
  if [ ! -f "$TARGET" ]; then
    echo "patch target not found: $TARGET" >&2
    exit 1
  fi

  # Defense in depth: even though TARGET is now a hardcoded path (not
  # attacker-influenced), still confirm it resolves inside the extracted
  # tree it's supposed to belong to -- protects against a corrupted or
  # tampered upstream archive substituting a symlinked intermediate
  # directory to escape ALLOWED_ROOT.
  REAL_ROOT="$(cd "$ALLOWED_ROOT" && pwd -P)"
  REAL_TARGET_DIR="$(cd "$(dirname "$TARGET")" && pwd -P)"
  case "$REAL_TARGET_DIR" in
    "$REAL_ROOT"|"$REAL_ROOT"/*)
      ;;
    *)
      echo "invalid patch target: resolved path escapes $ALLOWED_ROOT: $REAL_TARGET_DIR" >&2
      exit 1
      ;;
  esac

  # Each mode only knows how to apply its own one specific string patch.
  # Refuse to proceed if the exact substitution pattern isn't present
  # exactly once (e.g. libheif's @PROJECT_VERSION_PATCH@ also appears,
  # without the trailing quote, in the unrelated LIBHEIF_NUMERIC_VERSION
  # line -- PATCH_PATTERN above includes the trailing quote specifically to
  # avoid matching that).
  MATCH_COUNT=$(grep -Fc "$PATCH_PATTERN" "$TARGET" || true)
  if [ "$MATCH_COUNT" -ne 1 ]; then
    echo "expected exactly 1 occurrence of $PATCH_PATTERN in $TARGET, found $MATCH_COUNT" >&2
    exit 1
  fi

  cp "$TARGET" "$TARGET.orig"
  case "$MODE" in
    modified-libheif)
      sed -i.bak "s/@PROJECT_VERSION_PATCH@\\"/@PROJECT_VERSION_PATCH@-$MARKER\\"/" "$TARGET"
      ;;
    modified-libde265)
      sed -i.bak "s/@PACKAGE_VERSION@\\"/@PACKAGE_VERSION@-$MARKER\\"/" "$TARGET"
      ;;
  esac
  rm -f "$TARGET.bak"
  echo "Patched $TARGET:"
  diff -u "$TARGET.orig" "$TARGET" || true
fi

emmake make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"

mkdir -p "$PACKAGE_ROOT/out/$MODE"
cp dec/heic_dec.js dec/heic_dec.wasm "$PACKAGE_ROOT/out/$MODE/"
# heic_dec.js uses ESM syntax (import.meta.url); needs a sibling package.json
# declaring "type": "module" to load correctly outside the real npm package
# (whose own package.json normally provides this) -- see PR #12.
echo '{"type":"module"}' > "$PACKAGE_ROOT/out/$MODE/package.json"

echo ""
echo "Output: out/$MODE/heic_dec.wasm, out/$MODE/heic_dec.js"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum dec/heic_dec.wasm dec/heic_dec.js
else
  shasum -a 256 dec/heic_dec.wasm dec/heic_dec.js
fi
`;
}

function buildVerifyMjs() {
  return `#!/usr/bin/env node
// Standalone verification helper for this package. No dependencies beyond
// Node's built-ins (WebAssembly, crypto, fs) -- mirrors
// .github/workflows/lgpl-heic-rebuild/wasm-inspect.mjs and
// decode-smoke-test.mjs from PR #12, adapted to run outside that workflow.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const smokeTest = args.includes("--smoke-test");
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  console.error("usage: verify.mjs <heic_dec.wasm>");
  console.error("       verify.mjs --smoke-test <heic_dec.js>");
  process.exit(1);
}

if (smokeTest) {
  const jsPath = path.resolve(target);
  const wasmPath = jsPath.replace(/\\.js$/, ".wasm");
  const moduleUrl = pathToFileURL(jsPath).href;
  const { default: createModule } = await import(moduleUrl);
  const wasmModule = await WebAssembly.compile(readFileSync(wasmPath));
  const mod = await createModule({
    noInitialRun: true,
    instantiateWasm(imports, successCallback) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      successCallback(instance);
      return instance.exports;
    },
  });
  if (typeof mod.decode !== "function") {
    console.log(JSON.stringify({ ok: false, reason: "decode() not exported" }, null, 2));
    process.exit(1);
  }
  const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;
  let result, threw = null;
  try {
    result = mod.decode(garbage);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  const ok = threw === null && (result === null || result === undefined);
  console.log(JSON.stringify({ ok, threw, resultType: typeof result }, null, 2));
  console.log(
    "\\nNOTE: this only confirms module instantiation + embind decode() callability +",
    "invalid-input rejection. It does NOT decode a real HEIC image.",
  );
  process.exit(ok ? 0 : 1);
}

const buf = readFileSync(target);
const sha256 = createHash("sha256").update(buf).digest("hex");
const mod = await WebAssembly.compile(buf);
const imports = WebAssembly.Module.imports(mod);
const exports = WebAssembly.Module.exports(mod);
console.log(
  JSON.stringify(
    {
      path: target,
      size: buf.length,
      sha256,
      importCount: imports.length,
      exportCount: exports.length,
    },
    null,
    2,
  ),
);
`;
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
