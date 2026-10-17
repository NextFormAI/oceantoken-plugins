import { MARKER } from "../constants.js";

// `use codex` makes OceanToken the model provider in ~/.codex/config.toml. Like the
// MCP block, the file is edited as text, never parsed: the CLI adds two marked blocks
// and, because TOML forbids a key twice, comments out the user's own top-level
// `model` / `model_provider` lines with a prefix it can find again on revert.
//
//   # OceanToken model provider (added by @oceantoken/cli)   <- before the first table
//   model_provider = "oceantoken"
//   model = "openai/gpt-5.5"
//   # end OceanToken model provider
//   ...
//   # OceanToken provider table (added by @oceantoken/cli)   <- at the end
//   [model_providers.oceantoken]
//   ...
//   # end OceanToken provider table
//
// Codex 0.154 rejects a top-level `profile = ...`, so the keys go at the top level.

export const PROVIDER_ID = "oceantoken";
const TOP_BEGIN = `# OceanToken model provider (${MARKER})`;
const TOP_END = "# end OceanToken model provider";
const TABLE_BEGIN = `# OceanToken provider table (${MARKER})`;
const TABLE_END = "# end OceanToken provider table";
const DISABLED = "# disabled by @oceantoken/cli: ";
const TOP_KEYS = /^\s*(model_provider|model)\s*=/;
const TABLE_HEADER = /^\s*\[/;

const tomlString = (s) => JSON.stringify(s);

function cutBlock(lines, begin, end) {
  const start = lines.findIndex((l) => l.trim() === begin);
  if (start < 0) return false;
  const stop = lines.findIndex((l, i) => i > start && l.trim() === end);
  if (stop < 0) return false;
  lines.splice(start, stop - start + 1);
  return true;
}

const tidy = (lines) => `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s*$/, "")}\n`;

/**
 * Point Codex at OceanToken. `auth` is { headers } to keep the key in the file, or
 * { envKey } to have Codex read it from an environment variable.
 * Returns { status: created | added | updated | unchanged | manual, text?, reason? }.
 */
export function applyCodexProvider(text, { baseUrl, model, auth }) {
  const lines = (text ?? "").split("\n");
  cutBlock(lines, TOP_BEGIN, TOP_END);
  cutBlock(lines, TABLE_BEGIN, TABLE_END);
  const handWritten = new RegExp(`^\\s*\\[model_providers\\.(${PROVIDER_ID}|"${PROVIDER_ID}")\\]`);
  if (lines.some((l) => handWritten.test(l))) {
    return { status: "manual", reason: `config.toml already has a hand-written [model_providers.${PROVIDER_ID}] table` };
  }
  let firstTable = lines.findIndex((l) => TABLE_HEADER.test(l));
  if (firstTable < 0) firstTable = lines.length;
  for (let i = 0; i < firstTable; i++) {
    if (TOP_KEYS.test(lines[i])) lines[i] = `${DISABLED}${lines[i]}`;
  }
  const top = [TOP_BEGIN, `model_provider = ${tomlString(PROVIDER_ID)}`, `model = ${tomlString(model)}`, TOP_END, ""];
  lines.splice(firstTable, 0, ...top);

  const table = [TABLE_BEGIN, `[model_providers.${PROVIDER_ID}]`, 'name = "OceanToken"', `base_url = ${tomlString(baseUrl)}`, 'wire_api = "responses"'];
  if (auth.envKey) table.push(`env_key = ${tomlString(auth.envKey)}`);
  else {
    const pairs = Object.entries(auth.headers).map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`);
    table.push(`http_headers = { ${pairs.join(", ")} }`);
  }
  table.push(TABLE_END);
  const out = tidy([...lines, "", ...table]);
  if (text === null || text === undefined) return { status: "created", text: out };
  if (out === tidy(text.split("\n"))) return { status: "unchanged", text };
  return { status: text.includes(TOP_BEGIN) ? "updated" : "added", text: out };
}

/** Undo applyCodexProvider: drop both blocks and bring back the lines it commented out. */
export function revertCodexProvider(text) {
  if (!text) return { status: "absent", text };
  const lines = text.split("\n");
  const top = cutBlock(lines, TOP_BEGIN, TOP_END);
  const table = cutBlock(lines, TABLE_BEGIN, TABLE_END);
  let restored = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(DISABLED)) {
      lines[i] = lines[i].slice(DISABLED.length);
      restored = true;
    }
  }
  if (!top && !table && !restored) return { status: "absent", text };
  return { status: "removed", text: tidy(lines) };
}

/** Whether config.toml currently routes Codex through OceanToken. */
export const codexUsesOceanToken = (text) => Boolean(text?.includes(TOP_BEGIN));
