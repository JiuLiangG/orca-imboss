export interface AgentEnvironment {
  rootDir: string;
}

/**
 * Renderer-facing view of the agent working directory setting.
 *
 * `configured` is the raw `agent.workdir` value (`null` when unset);
 * `effective` is the path actually used (the configured path, or the app's
 * default `~/.imboss/workdir`); `isDefault` is true when no custom path is set.
 */
export interface WorkDirState {
  configured: string | null;
  effective: string;
  isDefault: boolean;
}

export interface TeamToolOptions {
  env: AgentEnvironment;
  employeeId: number;
  chatId: number;
  /** Employee's configured MCP/tool selection; may include built-in opt-in markers. */
  mcp?: string[];
}
