import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { KEY, cli, exists, read, readJson, tempHome } from "./helpers.js";

const URL = "https://mcp.oceantoken.ai/mcp";
const cmdline = (c) => [c.cmd, ...c.args].join(" ");

test("cursor: server entry and skills are written, a rerun changes nothing, disconnect removes both", async () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, ".cursor"));
  fs.writeFileSync(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { github: { url: "g" } } }));

  const first = await cli(["connect", "cursor"], { home });
  assert.equal(first.code, 0, first.out);
  assert.deepEqual(readJson(path.join(home, ".cursor", "mcp.json")).mcpServers, { github: { url: "g" }, oceantoken: { url: URL } });
  assert.ok(exists(path.join(home, ".cursor", "skills", "oceantoken-media", "SKILL.md")));
  assert.match(first.out, /Result {4}connected/);
  assert.match(first.out, /Tools & MCP/);
  assert.doesNotMatch(first.out, new RegExp(home), "paths are shown relative to ~");

  const again = await cli(["connect", "cursor"], { home });
  assert.match(again.out, /mcp\.json \(unchanged\)/);

  const gone = await cli(["disconnect", "cursor"], { home });
  assert.equal(gone.code, 0);
  assert.deepEqual(readJson(path.join(home, ".cursor", "mcp.json")).mcpServers, { github: { url: "g" } });
  assert.ok(!exists(path.join(home, ".cursor", "skills", "oceantoken-media")));
});

test("an API key goes into the config as a bearer header and never into the output", async () => {
  const home = tempHome();
  const res = await cli(["connect", "cursor", "--api-key", KEY, "--json"], { home });
  assert.equal(res.code, 0, res.out);
  const entry = readJson(path.join(home, ".cursor", "mcp.json")).mcpServers.oceantoken;
  assert.deepEqual(entry, { url: URL, headers: { Authorization: `Bearer ${KEY}` } });
  assert.ok(!res.out.includes(KEY), "the key is not printed");
  const report = JSON.parse(res.out);
  assert.equal(report.auth, "api-key");
  assert.equal(report.signIn, "not needed (API key)");
  assert.equal(report.result, "connected");
});

test("a rejected API key stops before anything is written", async () => {
  const home = tempHome();
  const res = await cli(["connect", "cursor", "--api-key", KEY], { home, models: 401 });
  assert.equal(res.code, 1);
  assert.match(res.out, /API key .*rejected/);
  assert.ok(!exists(path.join(home, ".cursor", "mcp.json")));
});

test("a malformed key, an unknown client and a missing client are usage errors", async () => {
  assert.equal((await cli(["connect", "cursor", "--api-key", "hello"])).code, 2);
  const unknown = await cli(["connect", "notepad"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /Supported: codex, claude-code, cursor/);
  assert.equal((await cli(["connect"])).code, 2);
  assert.equal((await cli(["connect", "claude"], { bins: ["claude"] })).code, 0, "aliases resolve");
});

test("codex: marketplace, plugin, then the native OAuth sign-in in the user's terminal", async () => {
  const res = await cli(["connect", "codex"], { bins: ["codex"] });
  assert.equal(res.code, 0, res.out);
  assert.deepEqual(res.calls.map(cmdline), [
    "codex plugin marketplace add NextFormAI/oceantoken-plugins",
    "codex plugin marketplace upgrade oceantoken",
    "codex plugin add oceantoken@oceantoken",
    "codex mcp login oceantoken",
  ]);
  assert.equal(res.calls[3].inherit, true);
  assert.match(res.out, /Sign-in {3}done/);
});

test("codex with --no-login configures only and says how to sign in", async () => {
  const res = await cli(["connect", "codex", "--no-login"], { bins: ["codex"] });
  assert.ok(!res.calls.some((c) => c.args.includes("login")));
  assert.match(res.out, /codex mcp login oceantoken/);
});

test("codex with a key: a marked config.toml block and skills in ~/.agents; OAuth again removes the block", async () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, ".codex"));
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "gpt-5.5"\n');
  const keyed = await cli(["connect", "codex", "--api-key", KEY], { home, bins: ["codex"] });
  assert.equal(keyed.code, 0, keyed.out);
  const toml = read(path.join(home, ".codex", "config.toml"));
  assert.match(toml, /\[mcp_servers\.oceantoken\]\nurl = "https:\/\/mcp\.oceantoken\.ai\/mcp"\nhttp_headers = \{ "Authorization" = "Bearer sk-/);
  assert.equal(keyed.calls.length, 0, "no plugin and no sign-in with a key");
  assert.ok(exists(path.join(home, ".agents", "skills", "oceantoken-models", "SKILL.md")));

  const oauth = await cli(["connect", "codex", "--no-login"], { home, bins: ["codex"] });
  assert.equal(oauth.code, 0);
  assert.equal(read(path.join(home, ".codex", "config.toml")).trim(), 'model = "gpt-5.5"');
});

test("a missing host CLI fails with install advice", async () => {
  const res = await cli(["connect", "codex"]);
  assert.equal(res.code, 1);
  assert.match(res.out, /npm install -g @openai\/codex/);
});

test("a failing host command fails the connect and shows its output", async () => {
  const res = await cli(["connect", "codex"], {
    bins: ["codex"],
    respond: (cmd, args) =>
      args.join(" ") === "plugin add oceantoken@oceantoken" ? { code: 3, stdout: "", stderr: "boom" } : { code: 0, stdout: "", stderr: "" },
  });
  assert.equal(res.code, 1);
  assert.match(res.out, /codex plugin add oceantoken@oceantoken exited 3: boom/);
  assert.ok(!res.calls.some((c) => c.args.includes("login")), "no sign-in after a failed install");
});

test("claude-code: plugin install is idempotent and sign-in is done in /mcp", async () => {
  const res = await cli(["connect", "claude-code"], {
    bins: ["claude"],
    respond: (cmd, args) =>
      args[1] === "install" ? { code: 1, stdout: 'Plugin "oceantoken@oceantoken" is already installed', stderr: "" } : { code: 0, stdout: "", stderr: "" },
  });
  assert.equal(res.code, 0, res.out);
  assert.deepEqual(res.calls.map(cmdline), [
    "claude plugin marketplace add NextFormAI/oceantoken-plugins",
    "claude plugin marketplace update oceantoken",
    "claude plugin install oceantoken@oceantoken",
    "claude plugin update oceantoken@oceantoken",
  ]);
  assert.match(res.out, /run \/mcp, choose plugin:oceantoken:oceantoken/);
});

test("claude-code with a key: a user-scope server with the header, skills in ~/.claude/skills", async () => {
  const res = await cli(["connect", "claude-code", "--api-key", KEY], { bins: ["claude"] });
  assert.equal(res.code, 0, res.out);
  assert.equal(
    cmdline(res.calls[1]),
    `claude mcp add --transport http --scope user oceantoken ${URL} --header Authorization: Bearer ${KEY}`,
  );
  assert.ok(exists(path.join(res.home, ".claude", "skills", "oceantoken-setup", "SKILL.md")));
  assert.ok(!res.out.includes(KEY));
});

test("gemini: install the extension with consent, or update it when already there", async () => {
  const fresh = await cli(["connect", "gemini"], { bins: ["gemini"] });
  assert.deepEqual(fresh.calls.map(cmdline), [
    "gemini extensions install https://github.com/NextFormAI/oceantoken-plugins --consent",
  ]);
  assert.match(fresh.out, /\/mcp auth oceantoken/);

  const home = tempHome();
  fs.mkdirSync(path.join(home, ".gemini", "extensions", "oceantoken"), { recursive: true });
  fs.writeFileSync(path.join(home, ".gemini", "extensions", "oceantoken", "gemini-extension.json"), "{}");
  const update = await cli(["connect", "gemini"], { home, bins: ["gemini"] });
  assert.deepEqual(update.calls.map(cmdline), ["gemini extensions update oceantoken"]);
});

test("openclaw: ClawHub plugin for the skills, a managed OAuth server, then mcp login", async () => {
  const res = await cli(["connect", "openclaw"], { bins: ["openclaw"] });
  assert.equal(res.code, 0, res.out);
  assert.deepEqual(res.calls.map(cmdline), [
    "openclaw plugins install clawhub:@oceantoken/oceantoken --accept-capabilities",
    `openclaw mcp set oceantoken {"url":"${URL}","transport":"streamable-http","auth":"oauth"}`,
    "openclaw mcp login oceantoken",
  ]);
  assert.equal(res.calls[2].inherit, true);
});

test("opencode: a fresh config gets the schema; a commented one is left for the user", async () => {
  const home = tempHome();
  const res = await cli(["connect", "opencode", "--no-login"], { home });
  const file = path.join(home, ".config", "opencode", "opencode.json");
  assert.deepEqual(readJson(file), {
    $schema: "https://opencode.ai/config.json",
    mcp: { oceantoken: { type: "remote", url: URL, enabled: true } },
  });
  assert.ok(exists(path.join(home, ".config", "opencode", "skills", "oceantoken-media")));
  assert.match(res.out, /opencode mcp auth oceantoken/);

  const home2 = tempHome();
  const jsonc = path.join(home2, ".config", "opencode", "opencode.jsonc");
  fs.mkdirSync(path.dirname(jsonc), { recursive: true });
  fs.writeFileSync(jsonc, "{\n  // mine\n}\n");
  const manual = await cli(["connect", "opencode"], { home: home2 });
  assert.equal(manual.code, 0);
  assert.match(manual.out, /Result {4}incomplete/);
  assert.match(manual.out, /Add this to ~\/\.config\/opencode\/opencode\.jsonc/);
  assert.equal(read(jsonc), "{\n  // mine\n}\n");
});

test("hermes, workbuddy, windsurf and vscode write their own config formats", async () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, ".config", "devin"), { recursive: true });
  for (const client of ["hermes", "workbuddy", "windsurf", "vscode"]) {
    const res = await cli(["connect", client, "--no-login"], { home });
    assert.equal(res.code, 0, `${client}: ${res.out}`);
  }
  assert.match(read(path.join(home, ".hermes", "config.yaml")), /mcp_servers:\n  # OceanToken[^\n]*\n  oceantoken:\n    url: "https:\/\/mcp\.oceantoken\.ai\/mcp"\n    auth: oauth/);
  assert.ok(exists(path.join(home, ".hermes", "skills", "oceantoken-media")));
  assert.deepEqual(readJson(path.join(home, ".workbuddy-ai", "mcp.json")).mcpServers.oceantoken, { type: "streamableHttp", url: URL });
  assert.deepEqual(readJson(path.join(home, ".config", "devin", "mcp_config.json")).mcpServers.oceantoken, { serverUrl: URL });
  const vscodeDir =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Code", "User")
      : path.join(home, ".config", "Code", "User");
  if (process.platform !== "win32") {
    assert.deepEqual(readJson(path.join(vscodeDir, "mcp.json")).servers.oceantoken, { type: "http", url: URL });
  }
  assert.ok(exists(path.join(home, ".copilot", "skills", "oceantoken-models")));
});

test("--dry-run changes nothing and runs nothing", async () => {
  const home = tempHome();
  const res = await cli(["connect", "codex", "--dry-run"], { home, bins: ["codex"] });
  assert.equal(res.calls.length, 0);
  assert.match(res.out, /would run: codex plugin add oceantoken@oceantoken/);
  const files = await cli(["connect", "cursor", "--dry-run"], { home });
  assert.ok(!exists(path.join(home, ".cursor")));
  assert.match(files.out, /would be created/);
});

test("clients lists what is detected", async () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, ".workbuddy-ai"));
  const res = await cli(["clients"], { home, bins: ["claude"] });
  assert.match(res.out, /claude-code\s+yes/);
  assert.match(res.out, /workbuddy\s+yes/);
  assert.match(res.out, /codex\s+no/);
});
