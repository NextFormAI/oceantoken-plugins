import { MARKETPLACE, PLUGIN_ID, PLUGIN_REPO, SERVER_NAME } from "../constants.js";
import { exists } from "../lib/fsutil.js";
import { requireCli, signInInApp } from "./common.js";

const claudeDir = (ctx) => ctx.env.CLAUDE_CONFIG_DIR || ctx.path(".claude");
const INSTALL = "Install Claude Code first: npm install -g @anthropic-ai/claude-code (https://docs.anthropic.com/claude-code).";

export default {
  id: "claude-code",
  label: "Claude Code",
  aliases: ["claude", "claudecode", "claude-code-cli"],
  detect: (ctx) => Boolean(ctx.which("claude")) || exists(claudeDir(ctx)),

  async connect(ctx) {
    if (!requireCli(ctx, "claude", INSTALL)) return;
    if (ctx.native) {
      const added = await ctx.exec("Marketplace", "claude", ["plugin", "marketplace", "add", PLUGIN_REPO], {
        okWhen: (out) => /already/i.test(out),
      });
      if (!added.ok) return;
      await ctx.exec("Marketplace refresh", "claude", ["plugin", "marketplace", "update", MARKETPLACE], { allowFail: true });
      const plugin = await ctx.exec("Plugin", "claude", ["plugin", "install", PLUGIN_ID], {
        okWhen: (out) => /already installed/i.test(out),
      });
      if (!plugin.ok) return;
      await ctx.exec("Plugin update", "claude", ["plugin", "update", PLUGIN_ID], { allowFail: true });
      ctx.report.mcp = `plugin:${MARKETPLACE}:${SERVER_NAME} via plugin ${PLUGIN_ID}`;
      ctx.report.skills = `via plugin ${PLUGIN_ID}`;
      signInInApp(
        ctx,
        `Sign in: in Claude Code run /mcp, choose plugin:${MARKETPLACE}:${SERVER_NAME} and select Authenticate.`,
      );
    } else {
      // Replace rather than duplicate a user-scope entry from an earlier run.
      await ctx.exec("Old entry", "claude", ["mcp", "remove", SERVER_NAME, "--scope", "user"], { allowFail: true });
      const args = ["mcp", "add", "--transport", "http", "--scope", "user", SERVER_NAME, ctx.mcpUrl];
      if (ctx.headers) args.push("--header", `Authorization: ${ctx.headers.Authorization}`);
      const added = await ctx.exec("MCP server", "claude", args);
      if (!added.ok) return;
      ctx.report.mcp = `${SERVER_NAME} (user scope)`;
      ctx.installSkillsTo(`${claudeDir(ctx)}/skills`);
      signInInApp(ctx, `Sign in: in Claude Code run /mcp, choose ${SERVER_NAME} and select Authenticate.`);
    }
    ctx.report.restart = "start a new Claude Code session";
  },

  async disconnect(ctx) {
    if (ctx.which("claude")) {
      await ctx.exec("Plugin", "claude", ["plugin", "uninstall", PLUGIN_ID], { allowFail: true });
      await ctx.exec("MCP server", "claude", ["mcp", "remove", SERVER_NAME, "--scope", "user"], { allowFail: true });
    }
    ctx.removeSkillsFrom(`${claudeDir(ctx)}/skills`);
  },
};
