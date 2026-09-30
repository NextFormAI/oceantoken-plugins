import path from "node:path";
import { DEFAULT_MCP_URL } from "./constants.js";
import { readIfExists, writeFileSafely } from "./lib/fsutil.js";
import { removeJsonEntry, upsertJsonEntry } from "./lib/json-config.js";
import { redact, run as realRun, which as realWhich } from "./lib/run.js";
import { installSkills, removeSkills } from "./lib/skills.js";

const MARKS = { ok: "✓", skipped: "–", manual: "!", failed: "✗", pending: "…" };

/**
 * Everything a client module needs: where things live, what the user asked for, and
 * helpers that do one step each and record it in the report. A client module never
 * prints or touches the filesystem except through these.
 */
export function createContext({
  client,
  home,
  env = process.env,
  mcpUrl = DEFAULT_MCP_URL,
  apiKey = null,
  dryRun = false,
  login = true,
  skills = true,
  quiet = false,
  runner = realRun,
  whichImpl = realWhich,
  print = (line) => process.stdout.write(`${line}\n`),
}) {
  const secrets = apiKey ? [apiKey] : [];
  const report = {
    client: client.id,
    label: client.label,
    auth: apiKey ? "api-key" : "oauth",
    mcpUrl,
    dryRun,
    steps: [],
    mcp: null,
    skills: null,
    signIn: null,
    restart: null,
    next: [],
  };

  // Paths read better as ~/...; secrets never leave this object unredacted.
  const clean = (text) => redact(String(text), secrets).split(home).join("~");
  const say = (line) => {
    if (!quiet) print(clean(line));
  };

  const ctx = {
    client,
    home,
    env,
    mcpUrl,
    apiKey,
    dryRun,
    login,
    skills,
    report,
    /** The host's own plugin/extension can be used: OAuth against the production server. */
    native: !apiKey && mcpUrl === DEFAULT_MCP_URL,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,

    path: (...parts) => path.join(home, ...parts),
    which: (cmd) => whichImpl(cmd, env),

    step(name, status, detail = "") {
      report.steps.push({ name, status, detail: clean(detail) });
      say(`  ${MARKS[status] ?? "·"} ${name.padEnd(22)} ${detail}`);
    },
    next(message) {
      report.next.push(clean(message));
    },
    /** Report fields go through the same cleaning as step lines before they are shown. */
    finalize() {
      for (const field of ["mcp", "skills", "signIn", "restart"]) {
        if (report[field] != null) report[field] = clean(report[field]);
      }
      report.mcpUrl = clean(report.mcpUrl);
      return report;
    },

    /**
     * Run a host CLI command as one step. `inherit` hands the terminal to the child
     * (sign-in prints a URL and waits for the browser). In a dry run nothing runs.
     */
    async exec(name, cmd, args, { inherit = false, allowFail = false, okWhen } = {}) {
      const shown = `${cmd} ${args.map((a) => (/\s|["{]/.test(a) ? `'${a}'` : a)).join(" ")}`;
      if (dryRun) {
        ctx.step(name, "skipped", `would run: ${shown}`);
        return { ok: true, code: 0, stdout: "", stderr: "" };
      }
      if (inherit) say(`  ${MARKS.pending} ${name.padEnd(22)} ${shown}`);
      const res = await runner(cmd, args, { inherit, env });
      const output = `${res.stdout}\n${res.stderr}`;
      const ok = res.code === 0 || (okWhen ? okWhen(output) : false);
      if (ok) ctx.step(name, "ok", inherit ? "done" : shown);
      else {
        const tail = output.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
        ctx.step(name, allowFail ? "skipped" : "failed", `${shown} exited ${res.code}${tail ? `: ${tail}` : ""}`);
      }
      return { ok, ...res };
    },

    /** Set one entry in a JSON config file; falls back to a manual snippet when it cannot. */
    writeJson(name, file, keyPath, entry, { init } = {}) {
      const res = upsertJsonEntry(file, keyPath, entry, { dryRun, secret: Boolean(apiKey), init });
      if (res.status === "manual") {
        ctx.step(name, "manual", `${file}: ${res.reason}`);
        ctx.next(`Add this to ${file}:\n${res.snippet}`);
        return false;
      }
      ctx.step(name, "ok", `${file} (${dryRun ? `would be ${res.status}` : res.status})`);
      return true;
    },
    removeJson(name, file, keyPath) {
      const res = removeJsonEntry(file, keyPath, { dryRun });
      if (res.status === "manual") {
        ctx.step(name, "manual", `${file}: ${res.reason}`);
        ctx.next(`Remove "${keyPath.join(".")}" from ${file}.`);
        return;
      }
      ctx.step(name, res.status === "removed" ? "ok" : "skipped", `${file} (${res.status})`);
    },

    /** Apply a text edit (TOML/YAML block) to a file. */
    editText(name, file, edit) {
      const before = readIfExists(file);
      const res = edit(before);
      if (res.status === "manual") {
        ctx.step(name, "manual", `${file}: ${res.reason}`);
        return false;
      }
      if (res.status === "unchanged" || res.status === "absent") {
        ctx.step(name, res.status === "absent" ? "skipped" : "ok", `${file} (${res.status})`);
        return true;
      }
      if (!dryRun) writeFileSafely(file, res.text, { secret: Boolean(apiKey) });
      ctx.step(name, "ok", `${file} (${dryRun ? `would be ${res.status}` : res.status})`);
      return true;
    },

    installSkillsTo(dir) {
      if (!skills) {
        ctx.step("Skills", "skipped", "--no-skills");
        return;
      }
      const res = installSkills(dir, { dryRun });
      for (const name of res.skipped) ctx.next(`${path.join(dir, name)} already exists and was not installed by this CLI; left as is.`);
      ctx.step("Skills", "ok", `${res.installed.length} in ${dir}`);
      report.skills = `${res.installed.join(", ")} in ${dir}`;
    },
    removeSkillsFrom(dir) {
      const res = removeSkills(dir, { dryRun });
      ctx.step("Skills", res.removed.length ? "ok" : "skipped", res.removed.length ? `removed from ${dir}` : `none in ${dir}`);
    },
  };
  return ctx;
}

