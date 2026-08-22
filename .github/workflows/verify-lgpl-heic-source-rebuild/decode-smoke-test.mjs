#!/usr/bin/env node
// Spike-only helper (not part of normal FileFit CI/build). Loads a rebuilt heic_dec.js
// (Emscripten MODULARIZE=1/EXPORT_ES6=1 output) in plain Node and calls the embind-exposed
// decode() with a deliberately invalid buffer.
//
// This is intentionally NOT a real-photo decode test: no HEIC fixture with clear
// redistribution rights is available (see PR #12/#13 for why). jSquash's heic_dec.cpp
// returns val::null() on any parse error, so a correctly wired module (embind bindings +
// wasm instantiation + JS glue) must resolve to null here without throwing. This proves
// the rebuilt module loads and is callable end-to-end; it does not prove pixel-accurate
// decoding of real image data.
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const jsPath = process.argv[2];
if (!jsPath) {
  console.error("usage: decode-smoke-test.mjs <heic_dec.js path>");
  process.exit(1);
}

const moduleUrl = pathToFileURL(path.resolve(jsPath)).href;
const { default: createModule } = await import(moduleUrl);

// This build is compiled with -s ENVIRONMENT=web,worker (matching upstream's
// Makefile), which excludes "node" from the environments Emscripten generates
// fallback loading code for. Its default wasm loader therefore always uses
// fetch(), which Node's fetch (undici) cannot use with a file:// URL. Bypass
// that entirely via Emscripten's documented manual-instantiation hook.
const wasmPath = jsPath.replace(/\.js$/, ".wasm");
const wasmBytes = readFileSync(wasmPath);
const wasmModule = await WebAssembly.compile(wasmBytes);

const mod = await createModule({
  noInitialRun: true,
  instantiateWasm(imports, successCallback) {
    const instance = new WebAssembly.Instance(wasmModule, imports);
    successCallback(instance);
    return instance.exports;
  },
});

if (typeof mod.decode !== "function") {
  console.log(
    JSON.stringify(
      { ok: false, reason: "decode is not exported as a function on the instantiated Module" },
      null,
      2,
    ),
  );
  process.exit(1);
}

const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;

let result;
let threw = null;
try {
  result = mod.decode(garbage);
} catch (error) {
  threw = error instanceof Error ? error.message : String(error);
}

const ok = threw === null && (result === null || result === undefined);

console.log(
  JSON.stringify(
    {
      ok,
      threw,
      resultIsNullish: result === null || result === undefined,
      resultType: typeof result,
    },
    null,
    2,
  ),
);

if (!ok) process.exit(1);
