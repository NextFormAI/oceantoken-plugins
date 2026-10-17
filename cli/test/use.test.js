import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { applyCodexProvider, revertCodexProvider } from "../src/lib/provider.js";
import { KEY, cli, exists, read, readJson, tempHome } from "./helpers.js";

const BASE = "https://api.oceantoken.ai";
const USER_TOML = 'model = "gpt-5.5"\nmodel_reasoning_effort = "high"\n\n[mcp_servers.github]\nurl = "https://g"\n';

test("codex: provider keys go above the first table, the user's model line is parked, revert restores the file", () => {
  const on = applyCodexProvider(USER_TOML, { baseUrl: `${BASE}/v1`, model: "openai/gpt-5.5", auth: { headers: { Authorization: "Bearer k" } } });
  assert.equal(on.status, "added");
  const lines = on.text.split("\n");
  const firstTable = lines.findIndex((l) => l.startsWith("["));
  assert.ok(lines.indexOf('model_provider = "oceantoken"') < firstTable, "top-level keys stay top-level");
  assert.ok(lines.includes('# disabled by @oceantoken/cli: model = "gpt-5.5"'));
  assert.equal(lines.filter((l) => /^model\s*=/.test(l)).length, 1, "TOML gets one model key");
  assert.match(on.text, /\[model_providers\.oceantoken\]\nname = "OceanToken"\nbase_url = "https:\/\/api\.oceantoken\.ai\/v1"\nwire_api = "responses"\nhttp_headers = \{ "Authorization" = "Bearer k" \}/);

  const again = applyCodexProvider(on.text, { baseUrl: `${BASE}/v1`, model: "openai/gpt-5.5", auth: { headers: { Authorization: "Bearer k" } } });
  assert.equal(again.status, "unchanged");
  const other = applyCodexProvider(on.text, { baseUrl: `${BASE}/v1`, model: "deepseek/deepseek-v4-pro", auth: { envKey: "OCEANTOKEN_API_KEY" } });
  assert.equal(other.status, "updated");
  assert.match(other.text, /env_key = "OCEANTOKEN_API_KEY"/);
  assert.doesNotMatch(other.text, /http_headers/);
  assert.equal((other.text.match(/disabled by/g) || []).length, 1, "a rerun does not park lines twice");

  const off = revertCodexProvider(other.text);
  assert.equal(off.status, "removed");
  assert.equal(off.text, USER_TOML);
  assert.equal(revertCodexProvider(off.text).status, "absent");
});

test("codex: a hand-written oceantoken provider is left alone; a file without tables still gets top-level keys first", () => {
  const hand = '[model_providers.oceantoken]\nbase_url = "https://x"\n';
  assert.equal(applyCodexProvider(hand, { baseUrl: "u", model: "m", auth: { envKey: "K" } }).status, "manual");
  const flat = applyCodexProvider('approval_policy = "never"\n', { baseUrl: "u", model: "m", auth: { envKey: "K" } });
  assert.ok(flat.text.indexOf("model_provider") < flat.text.indexOf("[model_providers"));
  assert.ok(flat.text.startsWith('approval_policy = "never"'));
});

test("use codex writes config.toml with the key, never prints it, and unuse restores the original", async () => {
  const home = tempHome();
  const file = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, USER_TOML);

  const res = await cli(["use", "codex", "--api-key", KEY], { home });
  assert.equal(res.code, 0, res.out);
  assert.match(read(file), new RegExp(`"Authorization" = "Bearer ${KEY}"`));
  assert.match(read(file), /^model = "openai\/gpt-5\.5"$/m);
  assert.ok(!res.out.includes(KEY), "the key is not printed");
  assert.match(res.out, /Result {4}switched/);
  assert.match(res.out, /unuse codex/);
  assert.equal(read(`${file}.bak-oceantoken`), USER_TOML, "the original is backed up");

  const back = await cli(["unuse", "codex"], { home });
  assert.equal(back.code, 0, back.out);
  assert.equal(read(file), USER_TOML);
});

test("use codex --use-env-key --model stores no key", async () => {
  const home = tempHome();
  const res = await cli(["use", "codex", "--use-env-key", "--model", "deepseek/deepseek-v4-pro"], { home, env: { OCEANTOKEN_API_KEY: KEY } });
  assert.equal(res.code, 0, res.out);
  const text = read(path.join(home, ".codex", "config.toml"));
  assert.match(text, /env_key = "OCEANTOKEN_API_KEY"/);
  assert.match(text, /model = "deepseek\/deepseek-v4-pro"/);
  assert.ok(!text.includes(KEY));
});

test("use claude-code sets the env block, keeps other settings, and unuse puts back exactly what was there", async () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file));
  const original = { theme: "dark", apiKeyHelper: "~/bin/my-key", env: { FOO: "1", ANTHROPIC_MODEL: "claude-opus-4-5" } };
  fs.writeFileSync(file, JSON.stringify(original));

  const res = await cli(["use", "claude-code", "--api-key", KEY], { home });
  assert.equal(res.code, 0, res.out);
  const on = readJson(file);
  assert.equal(on.theme, "dark");
  assert.equal(on.env.FOO, "1");
  assert.equal(on.env.ANTHROPIC_BASE_URL, BASE);
  assert.equal(on.env.ANTHROPIC_AUTH_TOKEN, KEY);
  assert.equal(on.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "anthropic/claude-sonnet-latest");
  assert.equal(on.env.ANTHROPIC_MODEL, undefined, "the user's pinned Claude model would bypass the mapping");
  assert.equal(on.apiKeyHelper, undefined, "a competing key helper is parked");
  assert.ok(!res.out.includes(KEY));
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  // A second run with other options must not overwrite the saved originals.
  const again = await cli(["use", "claude-code", "--api-key", KEY, "--model", "deepseek/deepseek-v4-pro"], { home });
  assert.equal(again.code, 0, again.out);
  assert.equal(readJson(file).env.ANTHROPIC_MODEL, "deepseek/deepseek-v4-pro");
  assert.equal(readJson(file).env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "deepseek/deepseek-v4-pro");

  const back = await cli(["unuse", "claude-code"], { home });
  assert.equal(back.code, 0, back.out);
  assert.deepEqual(readJson(file), original);
  assert.match((await cli(["unuse", "claude-code"], { home })).out, /nothing to undo/);
});

test("use claude-code --use-env-key installs a key helper instead of storing the key", async () => {
  const home = tempHome();
  const res = await cli(["use", "claude-code", "--use-env-key"], { home, env: { OCEANTOKEN_API_KEY: KEY } });
  assert.equal(res.code, 0, res.out);
  const on = readJson(path.join(home, ".claude", "settings.json"));
  assert.equal(on.apiKeyHelper, "printenv OCEANTOKEN_API_KEY");
  assert.equal(on.env.ANTHROPIC_AUTH_TOKEN, undefined);
  await cli(["unuse", "claude-code"], { home });
  assert.deepEqual(readJson(path.join(home, ".claude", "settings.json")), {});
});

test("use: a rejected key writes nothing; no key without a terminal is a usage error; other agents are refused", async () => {
  const home = tempHome();
  const rejected = await cli(["use", "codex", "--api-key", KEY], { home, models: 401 });
  assert.equal(rejected.code, 1);
  assert.ok(!exists(path.join(home, ".codex", "config.toml")));
  const noKey = await cli(["use", "codex"], { home });
  assert.equal(noKey.code, 2);
  assert.match(noKey.err, /--api-key -/);
  const cursor = await cli(["use", "cursor", "--api-key", KEY], { home });
  assert.equal(cursor.code, 2);
  assert.match(cursor.err, /Supported: codex, claude-code/);
});

test("use --dry-run changes nothing", async () => {
  const home = tempHome();
  const res = await cli(["use", "claude-code", "--api-key", KEY, "--dry-run"], { home });
  assert.equal(res.code, 0, res.out);
  assert.ok(!exists(path.join(home, ".claude", "settings.json")));
  assert.ok(!exists(path.join(home, ".oceantoken")));
  assert.match(res.out, /Result {4}dry run/);
});
