export interface AgentEnvironment {
  rootDir: string;
}

export interface TeamToolOptions {
  env: AgentEnvironment;
  employeeId: number;
  chatId: number;
  /** Employee's configured MCP/tool selection; may include built-in opt-in markers. */
  mcp?: string[];
}
