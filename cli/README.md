# @oceantoken/cli

Connect your AI agent to [OceanToken](https://oceantoken.ai), one account for 500+ AI models
(chat, image, video, speech, transcription), in one command.

```sh
npx -y @oceantoken/cli@latest connect <client>
```

It adds the OceanToken MCP server (`https://mcp.oceantoken.ai/mcp`) and the three OceanToken
skills to the client, then starts the client's own OAuth sign-in where it has one. Windsurf /
Devin Desktop has no skills folder, so it gets the server only. It supports ten clients:

| Client | `<client>` | How it is set up | Sign-in |
|---|---|---|---|
| Codex | `codex` | Codex plugin from this repo's marketplace | `codex mcp login` (browser) |
| Claude Code (terminal, IDE extension, desktop app) | `claude-code` | Claude Code plugin from this repo's marketplace | `claude mcp login` (browser) |
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
--api-key <key|->   Use an API key instead of OAuth sign-in ("-" reads it from stdin)
--use-env-key       Use the key in OCEANTOKEN_API_KEY
--no-login          Configure only; do not start the sign-in
--no-skills         Do not install the OceanToken skills
--dry-run           Show what would change without changing anything
--json              Print the report as JSON
--url <mcp-url>     MCP endpoint (default https://mcp.oceantoken.ai/mcp)
-h, --help          Show this help
-v, --version       Print the CLI version
```

Create an API key at https://app.oceantoken.ai/ui/?page=api-keys and hand it over with
`--api-key -` (stdin) or `--use-env-key`; `--api-key <key>` itself would leave it in your shell
history and in the process list while the CLI runs.

```sh
printf %s "$OCEANTOKEN_API_KEY" | npx -y @oceantoken/cli@latest connect <client> --api-key -
```

```sh
npx -y @oceantoken/cli@latest clients              # supported clients and which are installed
npx -y @oceantoken/cli@latest disconnect <client>  # remove what connect added
```

## What it changes

Only what OceanToken needs, and it is safe to run again:

- Codex, Claude Code and Gemini CLI get the official plugin (extension), installed with the
  host's own CLI. With an API key or `--url` they get one `oceantoken` server entry in their
  config instead.
- OpenClaw gets the ClawHub package (for the skills) and an OpenClaw-managed server entry.
- The other hosts get one `oceantoken` server entry in their MCP config file. Existing entries
  are kept, and a file with comments is never rewritten: you get the snippet to paste instead.
- Backups: before the CLI first edits a config file it copies it to `<file>.bak-oceantoken`,
  and it never overwrites that copy, so your original stays there however often you connect
  and disconnect. Each later change also leaves `<file>.bak-oceantoken-<UTC time>` (for example
  `mcp.json.bak-oceantoken-20261004T081530Z`) with the file as it was just before. A backup is
  a plain copy: if the file held an API key, so does the backup.
- Skills go into the host's own skills folder, marked so `disconnect` removes only what it
  installed.
- An API key is never passed to another program on its command line and never printed. It is
  written only to the host's own config file (`~/.claude.json` for Claude Code,
  `~/.gemini/settings.json` for Gemini CLI, the host's config file for the others), backed up
  first as above; OpenClaw receives it on stdin through `openclaw config patch` and writes
  `~/.openclaw/openclaw.json` itself.

## Docs

- Guide: https://docs.oceantoken.ai/agents/connect
- Manual setup for every host: https://github.com/NextFormAI/oceantoken-plugins#install
- Models and prices: https://oceantoken.ai/models

## For agents

An agent installing OceanToken for a user should follow
[INSTALL.md](https://mcp.oceantoken.ai/install).

MIT licensed. OceanToken is a product of NextForm LLC.
