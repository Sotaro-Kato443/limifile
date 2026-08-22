#!/usr/bin/env node
// Spike-only helper (not part of normal FileFit CI/build). Inspects a .wasm file's
// imports/exports/custom-sections using only Node's built-in WebAssembly API, and
// prints JSON to stdout. Used by .github/workflows/verify-lgpl-heic-source-rebuild.yml.
// Identical in approach to PR #12's .github/workflows/lgpl-heic-rebuild/wasm-inspect.mjs.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const path = process.argv[2];
if (!path) {
  console.error("usage: wasm-inspect.mjs <path.wasm>");
  process.exit(1);
}

const buf = readFileSync(path);
const sha256 = createHash("sha256").update(buf).digest("hex");
const mod = await WebAssembly.compile(buf);

const imports = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}(${i.kind})`);
const exports = WebAssembly.Module.exports(mod).map((e) => `${e.name}(${e.kind})`);

const customSectionNames = [
  "name",
  "producers",
  "target_features",
  "sourceMappingURL",
  "linking",
  "reloc.CODE",
];
const customSections = {};
for (const name of customSectionNames) {
  const sections = WebAssembly.Module.customSections(mod, name);
  customSections[name] = sections.reduce((total, s) => total + s.byteLength, 0);
}

console.log(
  JSON.stringify(
    {
      path,
      size: buf.length,
      sha256,
      importCount: imports.length,
      exportCount: exports.length,
      imports,
      exports,
      customSections,
    },
    null,
    2,
  ),
);
