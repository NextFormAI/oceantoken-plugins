import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli.js";

export const KEY = "sk-TestKey1234567890abcdef";

export function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oceantoken-cli-"));
}

/**
 * Run the CLI against a temp home with fake host binaries and a fake network.
 * `bins` lists the host CLIs that "exist"; every call to them is recorded and
 * answered by `respond` (default: success).
 */
export async function cli(argv, { home = tempHome(), bins = [], respond, models = 200, reachable = true, env = {} } = {}) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await main(argv, {
    home,
    env: { PATH: "/nonexistent", ...env },
    print: (l) => out.push(l),
    printErr: (l) => err.push(l),
    whichImpl: (cmd) => (bins.includes(cmd) ? `/fake/bin/${cmd}` : null),
    runner: async (cmd, args, opts) => {
      calls.push({ cmd, args, inherit: Boolean(opts?.inherit) });
      return respond ? respond(cmd, args) : { code: 0, stdout: "", stderr: "" };
    },
    fetchImpl: async (url) => {
      if (String(url).includes("/.well-known/")) {
        if (!reachable) throw new Error("offline");
        return { ok: true, status: 200 };
      }
      return { ok: models === 200, status: models };
    },
  });
  return { code, home, calls, out: out.join("\n"), err: err.join("\n") };
}

export const read = (file) => fs.readFileSync(file, "utf8");
export const readJson = (file) => JSON.parse(read(file));
export const exists = (file) => fs.existsSync(file);
