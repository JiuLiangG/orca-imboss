export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = ["en", "zh-CN"];

/**
 * The built-in assistant's hardcoded base system prompt. This REPLACES the
 * Pi SDK default base prompt for the assistant (id 0); the editable employee
 * `systemPrompt` is appended below it. Regular employees keep the SDK base.
 */
export const ASSISTANT_SYSTEM_PROMPT =
  "You are Imboss's built-in assistant — a proactive, reliable teammate for a one-person company. " +
  "Help the user plan and complete work, answer questions, and operate the workspace (employees, models, MCP servers, skills). " +
  "Prefer concise, direct answers. Use the provided tools (read, bash, edit, write) when the user asks you to inspect or change files.";

/**
 * Built-in tools that non-assistant employees can opt into via their "Linked
 * MCP" list. The markers (namespaced to avoid colliding with an MCP server
 * name) are stored in `employee.mcp` and honored at runtime by
 * `createTeamToolDefinitions`.
 */
export const BUILTIN_SET_CRON_MARKER = "builtin:set_cronjob";
export const BUILTIN_REMOVE_CRON_MARKER = "builtin:remove_cronjob";

// Setting keys
export const SettingKeys = {
  NavCollapse: "ui.navCollapsed",
  Module: "ui.module",
  WindowState: "ui.window",
};
