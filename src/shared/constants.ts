export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = ["en", "zh-CN"];

/**
 * The built-in assistant's hardcoded base system prompt. This REPLACES the
 * Pi SDK default base prompt for the assistant (id 0); the editable employee
 * `systemPrompt` is appended below it. Regular employees also go fully custom
 * (see `employee-prompt.ts`) — the SDK base is dropped for every employee.
 */
export const ASSISTANT_SYSTEM_PROMPT = `# Receiving a Task

1. Decide which employees should handle the task and who owns which part of it.
  1.1. List the existing employees (\`imb_list_employees\`) to see who is available to take on the work.
  1.2. Think about what additional roles or subject-matter expertise the task might require.
2. If any needed employees are missing, proactively recruit them by creating them in a batch via \`imb_set_employees\`.
  2.1. For each new employee, choose the tools and skills that fit their role.
3. Create the task group chat with \`imb_create_chat\`.
4. For every employee in the task group, send a message via \`imb_send_message\` that @-mentions them (notify the employee; the message body contains \`@{ID}\`), assigns the task and describes exactly what they should do.
5. Send a \`chat\`-kind message to the assistant↔user chat whose content is the new task group's chat id.`;

// ---------------------------------------------------------------------------
// Built-in skills appended to every employee's system prompt
// ---------------------------------------------------------------------------

/** Skill 1 — ask for clarification / collect feedback via `imb_ask`. */
export const BUILTIN_SKILLS_ASK = `### Asking Questions / Collecting Feedback

When you need clarification on something or need to gather feedback, use this skill.
Post the question(s) with the \`imb_ask\` tool. Once the message is sent, do nothing further — wait for the next instruction.`;

/** Skill 2 — how to react when @-mentioned, by message `kind`. */
export const BUILTIN_SKILLS_MENTION = `### Handling @-Mentions

When you are @-mentioned (the message body contains \`@{ID}\`), handle it according to the message's \`kind\`:
- \`text\`: Follow the instructions in the message.
- \`ask\`: If \`{ID}\` is 0 (you are the assistant), forward the message to the user (post it into the assistant↔user chat) and call the \`imb_notify\` tool to notify the user. If you are not the assistant (\`{ID}\` is not 0), answer according to your own role and call \`imb_answer\` to send the reply back to the asker.
- \`answer\`: This is an answer to a previous question. The message body is a JSON object — read it and continue processing.`;

/** Both built-in skills, joined as two blocks. */
export const BUILTIN_SKILLS = [BUILTIN_SKILLS_ASK, BUILTIN_SKILLS_MENTION].join(
  "\n\n",
);

// ---------------------------------------------------------------------------
// `[tools]` block building blocks (the `customPrompt` branch of the Pi SDK's
// buildSystemPrompt emits no `[tools]` section, so the app builds its own).
// ---------------------------------------------------------------------------

/** One-line snippets for the SDK core tools (used verbatim in `[tools]`). */
export const BASE_TOOL_SNIPPETS: Record<string, string> = {
  read: "Read file contents",
  bash: "Execute bash commands (ls, grep, find, etc.)",
  edit: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
  write: "Create or overwrite files",
};

/** Guidelines bullets for the `[tools]` block (rendered with a `- ` prefix). */
export const TOOLS_GUIDELINES: readonly string[] = [
  "Use bash for file operations like ls, grep, find",
  "Use read to examine files instead of cat or sed.",
  "You can inspect PI_* environment variables for current model and session details.",
  "Use edit for precise changes (edits[].oldText must match exactly)",
  "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
  "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
  "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
  "Use write only for new files or complete rewrites.",
  "Be concise in your responses",
  "Show file paths clearly when working with files",
];

/**
 * Built-in tools that non-assistant employees can opt into via their "Linked
 * MCP" list. The markers (namespaced to avoid colliding with an MCP server
 * name) are stored in `employee.mcp` and honored at runtime by
 * `createTeamToolDefinitions`.
 */
export const BUILTIN_SET_CRON_MARKER = "builtin:imb_set_cronjob";
export const BUILTIN_REMOVE_CRON_MARKER = "builtin:imb_remove_cronjob";

// Setting keys
export const SettingKeys = {
  NavCollapse: "ui.navCollapsed",
  Module: "ui.module",
  WindowState: "ui.window",
};

export const MCP_TRANSPORTS = ["stdio", "sse", "streamable-http"] as const;

/** Providers offered in the settings dropdown in addition to "Custom". */
export const CURATED_PROVIDERS = [
  "anthropic",
  "deepseek",
  "github-copilot",
  "google",
  "groq",
  "minimax-cn",
  "minimax",
  "moonshotai-cn",
  "moonshotai",
  "openai",
  "openrouter",
  "xai",
  "xiaomi",
  "zai",
] as const;

/** Names for the providers to display in UI */
export const CURATED_PROVIDERS_LABELS = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  "github-copilot": "GitHub Copilot",
  google: "Google",
  groq: "Groq",
  "minimax-cn": "MiniMax (CN)",
  minimax: "MiniMax",
  "moonshotai-cn": "Moonshot AI (CN)",
  moonshotai: "Moonshot AI",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
  xiaomi: "Xiaomi",
  zai: "Z.ai",
} as const;

/** API protocol flavors supported for custom providers (`models.json` `api`). */
export const PROVIDER_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const; /** The built-in assistant's reserved id — it must always exist. */

export const ASSISTANT_ID = 0;
/** Default signal sent to a participant whose chat was just written to. */

export const READ_CHAT_PROMPT =
  "You have new messages in this chat. Call imb_read_chat to read the latest messages and respond as appropriate.";
