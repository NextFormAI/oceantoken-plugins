import { API_BASE } from "../constants.js";

const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{8,}$/;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The API key to configure, or null for OAuth.
 * `--api-key -` reads it from stdin so it never appears in a command line or shell history.
 */
export async function resolveApiKey({ flag, useEnv, env = process.env }) {
  let key = null;
  if (flag === "-") key = await readStdin();
  else if (typeof flag === "string") key = flag;
  else if (useEnv) key = env.OCEANTOKEN_API_KEY ?? "";
  if (key === null) return null;
  key = key.trim();
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      useEnv && !flag
        ? "OCEANTOKEN_API_KEY is empty or is not an OceanToken API key (sk-...)"
        : "that is not an OceanToken API key (they start with sk-)",
    );
  }
  return key;
}

/** valid | rejected | unverified (network trouble is not a verdict on the key). */
export async function verifyApiKey(key, { apiBase = API_BASE, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(`${apiBase}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) return "rejected";
    return res.ok ? "valid" : "unverified";
  } catch {
    return "unverified";
  }
}

/** Is the MCP server reachable? Reads its public OAuth resource metadata. */
export async function serverReachable(mcpUrl, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const u = new URL(mcpUrl);
    const res = await fetchImpl(`${u.origin}/.well-known/oauth-protected-resource${u.pathname}`, {
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
