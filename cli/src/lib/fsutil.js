import fs from "node:fs";
import path from "node:path";

export function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

export function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Write a file through a temp file and rename, so a crash never leaves half a config.
 * An existing file keeps its permissions and gets one backup copy first; a new file
 * that may hold a key is created owner-only.
 */
export function writeFileSafely(file, text, { secret = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode = secret ? 0o600 : 0o644;
  if (exists(file)) {
    mode = fs.statSync(file).mode & 0o777;
    fs.copyFileSync(file, `${file}.bak-oceantoken`);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

export function copyDir(src, dst, { skip = [] } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to, { skip });
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
