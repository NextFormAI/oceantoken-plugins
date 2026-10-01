# @oceantoken/cli

Connect your AI agent to [OceanToken](https://oceantoken.ai), one account for 500+ AI models
(chat, image, video, speech, transcription), in one command.

```sh
npx -y @oceantoken/cli@latest connect <client>
```

It adds the OceanToken MCP server (`https://mcp.oceantoken.ai/mcp`) and the OceanToken skills
to the client, then starts the client's own OAuth sign-in where it has one.

| Client | `<client>` | How it is set up | Sign-in |
|---|---|---|---|
| Codex | `codex` | Codex plugin from this repo's marketplace | `codex mcp login` (browser) |
| Claude Code | `claude-code` | Claude Code plugin from this repo's marketplace | `/mcp` in Claude Code |
| Cursor | `cursor` | `~/.cursor/mcp.json` + `~/.cursor/skills` | Cursor Settings → Tools & MCP |
| Gemini CLI | `gemini` | Gemini CLI extension | `/mcp auth oceantoken` |
| OpenClaw | `openclaw` | ClawHub package + OpenClaw-managed server | `openclaw mcp login` (browser) |
| OpenCode | `opencode` | `~/.config/opencode/opencode.json` + skills | `opencode mcp auth` (browser) |
| VS Code (Copilot) | `vscode` | user `mcp.json` + `~/.copilot/skills` | in VS Code when the server starts |
| WorkBuddy | `workbuddy` | `~/.workbuddy-ai/mcp.json` + skills | in WorkBuddy |
| Hermes Agent | `hermes` | `~/.hermes/config.yaml` + skills | `hermes mcp login` (browser) |
| Windsurf / Devin Desktop | `windsurf` | `mcp_config.json` | in Cascade |

## Options

```text
--api-key <key|->   Use an API key instead of OAuth ("-" reads it from stdin)
--use-env-key       Use the key in OCEANTOKEN_API_KEY
--no-login          Configure only; do not start the sign-in
--no-skills         Do not install the skills
--dry-run           Show what would change without changing anything
--json              Print the report as JSON
```

```sh
npx -y @oceantoken/cli@latest clients              # supported clients and which are installed
npx -y @oceantoken/cli@latest disconnect <client>  # remove what connect added
```

## What it changes

Only what OceanToken needs, and it is safe to run again:

- Hosts with a plugin system (Codex, Claude Code, Gemini CLI, OpenClaw) get the official plugin,
  installed with the host's own CLI.
- Other hosts get one `oceantoken` server entry in their MCP config file. Existing entries are
  kept, the file is backed up to `<file>.bak-oceantoken` first, and a file with comments is never
  rewritten: you get the snippet to paste instead.
- Skills go into the host's own skills folder, marked so `disconnect` removes only what it
  installed.
- An API key is written only into the host's config, never printed.

## For agents

An agent installing OceanToken for a user should follow
[INSTALL.md](https://mcp.oceantoken.ai/install).

MIT licensed. OceanToken is a product of NextForm LLC.
