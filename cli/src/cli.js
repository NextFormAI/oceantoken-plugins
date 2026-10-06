import { createRequire } from "node:module";
import os from "node:os";
import { parseArgs } from "node:util";
import { CLIENTS, findClient } from "./clients/index.js";
import { API_BASE, DEFAULT_MCP_URL, DOCS_URL, KEYS_URL, SIGNUP_URL } from "./constants.js";
import { createContext } from "./context.js";
import { apiBaseFor, resolveApiKey, serverReachable, verifyApiKey } from "./lib/apikey.js";
import { redact } from "./lib/run.js";

const { version: VERSION } = createRequire(import.meta.url)("../package.json");

/** Every flag the CLI accepts. HELP and the README's Options section list each one (a test checks). */
export const OPTIONS = {
  "api-key": { type: "string" },
  "use-env-key": { type: "boolean", default: false },
  "no-login": { type: "boolean", default: false },
  "no-skills": { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  url: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
};

export const HELP = `OceanToken CLI ${VERSION}: connect your AI agent to OceanToken (500+ AI models, one account).

Usage
  npx -y @oceantoken/cli@latest connect <client> [options]
  npx -y @oceantoken/cli@latest disconnect <client>
  npx -y @oceantoken/cli@latest clients

Clients
${CLIENTS.map((c) => `  ${c.id.padEnd(12)} ${c.label}`).join("\n")}

Options for connect
  --api-key <key|->   Use an API key instead of OAuth sign-in ("-" reads it from stdin)
  --use-env-key       Use the key in OCEANTOKEN_API_KEY
  --no-login          Configure only; do not start the sign-in
  --no-skills         Do not install the OceanToken skills
  --dry-run           Show what would change without changing anything
  --json              Print the report as JSON
  --url <mcp-url>     MCP endpoint (default ${DEFAULT_MCP_URL})

Other options
  -h, --help          Show this help
  -v, --version       Print the CLI version

Sign-in uses OAuth by default: the client opens the OceanToken sign-in page.
An API key is never passed to another program on its command line and never printed.
API keys: ${KEYS_URL}   New account: ${SIGNUP_URL}
Docs: ${DOCS_URL}
`;

function parse(argv) {
  return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
}

function detectedClients(base) {
  return CLIENTS.filter((c) => {
    try {
      return c.detect(createContext({ client: c, ...base, quiet: true }));
    } catch {
      return false;
    }
  });
}

function summarize(report, print) {
  const failed = report.steps.some((s) => s.status === "failed");
  const manual = report.steps.some((s) => s.status === "manual");
  report.result = failed ? "failed" : manual || report.signIn === "failed" ? "incomplete" : "connected";
  if (report.dryRun) report.result = failed ? "failed" : "dry run";
  const rows = [
    ["Client", report.label],
    ["Auth", report.auth === "api-key" ? "API key" : "OAuth sign-in"],
    ["MCP", report.mcp ?? "not configured"],
    ["Skills", report.skills ?? "not installed"],
    ["Sign-in", report.signIn ?? "–"],
    ["Restart", report.restart ?? "–"],
    ["Result", report.result],
  ];
  print("");
  print("Summary");
  for (const [k, v] of rows) print(`  ${k.padEnd(9)} ${v}`);
  if (report.next.length) {
    print("");
    print("Next");
    for (const n of report.next) print(`  - ${n.replace(/\n/g, "\n    ")}`);
  }
}

/** Returns the process exit code. `deps` lets tests swap the environment and side effects. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const print = deps.print ?? ((line) => process.stdout.write(`${line}\n`));
  const printErr = deps.printErr ?? ((line) => process.stderr.write(`${line}\n`));
  const env = deps.env ?? process.env;
  const base = {
    home: deps.home ?? os.homedir(),
    env,
    runner: deps.runner,
    whichImpl: deps.whichImpl,
    print,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];

  let args;
  try {
    args = parse(argv);
  } catch (err) {
    printErr(`${err.message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = args;
  if (values.version) {
    print(VERSION);
    return 0;
  }
  const [command, clientName] = positionals;
  if (values.help || !command || command === "help") {
    print(HELP);
    return command || values.help ? 0 : 2;
  }

  if (command === "clients" || command === "list") {
    const found = new Set(detectedClients(base).map((c) => c.id));
    print("Client        Detected  Name");
    for (const c of CLIENTS) print(`${c.id.padEnd(13)} ${found.has(c.id) ? "yes     " : "no      "}  ${c.label}`);
    return 0;
  }

  if (command !== "connect" && command !== "disconnect") {
    printErr(`Unknown command "${command}".\n\n${HELP}`);
    return 2;
  }
  const client = findClient(clientName);
  if (!client) {
    const found = detectedClients(base).map((c) => c.id);
    printErr(
      `${clientName ? `Unknown client "${clientName}".` : "Say which client to connect."} Supported: ${CLIENTS.map((c) => c.id).join(", ")}.` +
        (found.length ? `\nDetected on this machine: ${found.join(", ")}.` : ""),
    );
    return 2;
  }

  let apiKey = null;
  if (command === "connect") {
    try {
      apiKey = await resolveApiKey({ flag: values["api-key"], useEnv: values["use-env-key"], env });
    } catch (err) {
      printErr(`Error: ${err.message}. Create a key at ${KEYS_URL}`);
      return 2;
    }
  }

  const quietSteps = values.json;
  const ctx = createContext({
    client,
    ...base,
    mcpUrl: values.url ?? DEFAULT_MCP_URL,
    apiKey,
    dryRun: values["dry-run"],
    login: !values["no-login"],
    skills: !values["no-skills"],
    quiet: quietSteps,
  });
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  if (!quietSteps) print(`OceanToken → ${client.label}${ctx.dryRun ? " (dry run)" : ""}`);
  try {
    if (command === "connect") {
      if (await serverReachable(ctx.mcpUrl, { fetchImpl })) ctx.step("Server", "ok", ctx.mcpUrl);
      else ctx.step("Server", "manual", `${ctx.mcpUrl} did not answer; continuing`);
      const apiBase = apiKey ? apiBaseFor(ctx.mcpUrl) : null;
      if (apiKey && !apiBase) {
        ctx.step("API key", "manual", `not checked: ${ctx.mcpUrl} has no matching OceanToken API; continuing`);
      } else if (apiKey) {
        const verdict = await verifyApiKey(apiKey, { apiBase, fetchImpl });
        if (verdict === "rejected") {
          ctx.step("API key", "failed", `rejected by ${apiBase === API_BASE ? "OceanToken" : new URL(apiBase).host} (wrong, revoked or expired)`);
          ctx.next(`Create or copy a key at ${KEYS_URL} and run this again.`);
        } else {
          ctx.step("API key", verdict === "valid" ? "ok" : "manual", verdict === "valid" ? "accepted" : "could not be checked; continuing");
        }
      }
      if (!ctx.report.steps.some((s) => s.status === "failed")) await client.connect(ctx);
    } else {
      await client.disconnect(ctx);
      ctx.report.result = ctx.report.steps.some((s) => s.status === "failed") ? "failed" : "disconnected";
    }
  } catch (err) {
    ctx.step("Error", "failed", redact(err?.message ?? String(err), apiKey ? [apiKey] : []));
  }

  ctx.finalize();
  if (command === "connect") {
    if (quietSteps) summarize(ctx.report, () => {});
    else summarize(ctx.report, print);
  } else if (!quietSteps) {
    print(`\nResult    ${ctx.report.result}`);
    for (const n of ctx.report.next) print(`  - ${n}`);
  }
  if (values.json) print(JSON.stringify(ctx.report, null, 2));
  return ctx.report.steps.some((s) => s.status === "failed") ? 1 : 0;
}
