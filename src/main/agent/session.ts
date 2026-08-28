import type { AgentEnvironment } from "./environment";

export interface AgentEvent {
  type: string;
  payload?: unknown;
}

export class AgentSession {
  constructor(private readonly _env: AgentEnvironment) {}

  /** Send a user message (prompt) to the assistant agent. */
  async prompt(_message: string): Promise<void> {
    // TODO(agent): create a Pi session via createAgentSession(...), subscribe
    // with session.subscribe(...), and forward streaming events (message_update,
    // tool_execution_*, message_*, turn_*, agent_*) to the renderer over IPC.
    void this._env;
  }
}
