import { PLUGIN_REPO_URL, SERVER_NAME } from "../constants.js";
import { exists } from "../lib/fsutil.js";
import { requireCli, signInInApp } from "./common.js";

const INSTALL = "Install Gemini CLI first: npm install -g @google/gemini-cli (https://geminicli.com).";

export default {
  id: "gemini",
  label: "Gemini CLI",
  aliases: ["gemini-cli", "google-gemini"],
  detect: (ctx) => Boolean(ctx.which("gemini")) || exists(ctx.path(".gemini")),

  async connect(ctx) {
    if (!requireCli(ctx, "gemini", INSTALL)) return;
    if (ctx.native) {
      const installed = exists(ctx.path(".gemini", "extensions", SERVER_NAME, "gemini-extension.json"));
      const res = installed
        ? await ctx.exec("Extension update", "gemini", ["extensions", "update", SERVER_NAME])
        : await ctx.exec("Extension", "gemini", ["extensions", "install", PLUGIN_REPO_URL, "--consent"]);
      if (!res.ok) return;
      ctx.report.mcp = `${SERVER_NAME} via the ${SERVER_NAME} extension`;
      ctx.report.skills = `via the ${SERVER_NAME} extension`;
      signInInApp(ctx, `Sign in: in Gemini CLI run /mcp auth ${SERVER_NAME}.`);
    } else {
      // A user-scope server overrides the extension's server of the same name.
      await ctx.exec("Old entry", "gemini", ["mcp", "remove", "--scope", "user", SERVER_NAME], { allowFail: true });
      const args = ["mcp", "add", "--scope", "user", "--transport", "http", SERVER_NAME, ctx.mcpUrl];
      if (ctx.headers) args.push("--header", `Authorization: ${ctx.headers.Authorization}`);
      const added = await ctx.exec("MCP server", "gemini", args);
      if (!added.ok) return;
      ctx.report.mcp = `${SERVER_NAME} (user settings)`;
      ctx.installSkillsTo(ctx.path(".gemini", "skills"));
      signInInApp(ctx, `Sign in: in Gemini CLI run /mcp auth ${SERVER_NAME}.`);
    }
    ctx.report.restart = "start a new Gemini CLI session";
  },

  async disconnect(ctx) {
    if (ctx.which("gemini")) {
      await ctx.exec("Extension", "gemini", ["extensions", "uninstall", SERVER_NAME], { allowFail: true });
      await ctx.exec("MCP server", "gemini", ["mcp", "remove", "--scope", "user", SERVER_NAME], { allowFail: true });
    }
    ctx.removeSkillsFrom(ctx.path(".gemini", "skills"));
  },
};
