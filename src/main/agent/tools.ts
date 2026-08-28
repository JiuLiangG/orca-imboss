export interface AgentTool {
  name: string;
  description: string;
}

/**
 * Define the tools exposed to the assistant. Tools run in the main process and
 * can close over the DB service for read/write during agent execution.
 *
 * TODO(agent): define tools with Pi SDK `defineTool(...)` (validated with
 * `typebox`). Their `execute` callbacks will access the SQLite data layer.
 */
export function defineAgentTools(): AgentTool[] {
  return [];
}
