// Minimal dependency-free USTAR tar + gzip writer used only by
// scripts/build-lgpl-heic-source-package.mjs. Not part of the Production
// build; exists purely so the LGPL source package tarball can be regenerated
// byte-for-byte from the same inputs, without adding a runtime/dev
// dependency for something this small. See that script for the "why".
import { gzipSync } from "node:zlib";

const BLOCK_SIZE = 512;
// Fixed for reproducibility: every entry gets this mtime regardless of the
// source file's real mtime, so re-running the build produces the same bytes.
const FIXED_MTIME_SECONDS = 0;

function octal(value, length) {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function padBuffer(buf, length, fill = 0) {
  if (buf.length >= length) return buf.subarray(0, length);
  const out = Buffer.alloc(length, fill);
  buf.copy(out);
  return out;
}

function splitPath(path) {
  if (Buffer.byteLength(path, "utf8") <= 100) return { prefix: "", name: path };
  const parts = path.split("/");
  let name = parts.pop();
  let prefix = parts.join("/");
  while (prefix.length > 0 && Buffer.byteLength(prefix, "utf8") > 155) {
    const idx = prefix.indexOf("/");
    if (idx === -1) break;
    name = prefix.slice(0, idx + 1) + name;
    prefix = prefix.slice(idx + 1);
  }
  if (Buffer.byteLength(name, "utf8") > 100 || Buffer.byteLength(prefix, "utf8") > 155) {
    throw new Error(`path too long for USTAR format: ${path}`);
  }
  return { prefix, name };
}

function buildHeader({ path, size, typeflag, executable }) {
  const header = Buffer.alloc(BLOCK_SIZE, 0);
  const { prefix, name } = splitPath(path);
  const mode = typeflag === "5" || executable ? 0o755 : 0o644;

  header.write(name, 0, 100, "utf8");
  header.write(octal(mode, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(size, 12), 124, 12, "ascii");
  header.write(octal(FIXED_MTIME_SECONDS, 12), 136, 12, "ascii");
  header.write("        ", 148, 8, "ascii"); // chksum placeholder
  header.write(typeflag, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write("filefit", 265, 32, "utf8");
  header.write("filefit", 297, 32, "utf8");
  header.write(octal(0, 8), 329, 8, "ascii");
  header.write(octal(0, 8), 337, 8, "ascii");
  header.write(prefix, 345, 155, "utf8");

  let sum = 0;
  for (const byte of header) sum += byte;
  const chksum = sum.toString(8).padStart(6, "0") + "\0 ";
  header.write(chksum, 148, 8, "ascii");

  return header;
}

/**
 * entries: array of { path, content?: Buffer, typeflag: "0" | "5", executable?: boolean }
 * Directory entries (typeflag "5") must end their path with "/" and have no content.
 * executable (regular files only) sets mode 0o755 instead of 0o644.
 * Returns a deterministic gzip-compressed tar Buffer: same entries in the same
 * order always produce identical output bytes.
 */
export function createDeterministicTarGz(entries) {
  const chunks = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0);
    chunks.push(
      buildHeader({
        path: entry.path,
        size: content.length,
        typeflag: entry.typeflag,
        executable: entry.executable,
      }),
    );
    if (content.length > 0) {
      chunks.push(padBuffer(content, Math.ceil(content.length / BLOCK_SIZE) * BLOCK_SIZE));
    }
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2, 0)); // end-of-archive marker
  const tarBuffer = Buffer.concat(chunks);

  // mtime: 0 and a fixed compression level make gzip output deterministic
  // across runs on the same platform/zlib version.
  return gzipSync(tarBuffer, { level: 9, mtime: 0 });
}
