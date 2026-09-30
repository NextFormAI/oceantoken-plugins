import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";

/** Absolute path of an executable on PATH, or null. */
export function which(cmd, env = process.env) {
  const dirs = (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const exts = isWindows ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext.toLowerCase());
      const upper = path.join(dir, cmd + ext);
      for (const file of new Set([candidate, upper])) {
        try {
          if (fs.statSync(file).isFile()) return file;
        } catch {
          // not here
        }
      }
    }
  }
  return null;
}

/** Replace every secret in text with a placeholder. */
export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("<hidden>");
  }
  return out;
}

function quoteForCmd(arg) {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

/**
 * Run a command without a shell.
 *
 * inherit: the child shares this terminal (used for sign-in, which prints a URL and waits).
 * Otherwise stdout/stderr are captured and returned.
 */
export function run(cmd, args, { inherit = false, env = process.env, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const exe = which(cmd, env) || cmd;
    const useShell = isWindows && /\.(cmd|bat)$/i.test(exe);
    const child = spawn(useShell ? quoteForCmd(exe) : exe, useShell ? args.map(quoteForCmd) : args, {
      env,
      shell: useShell,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err.message || err) });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 124 : 1), stdout, stderr });
    });
  });
}
