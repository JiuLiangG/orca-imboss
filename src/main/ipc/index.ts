import { registerAgentEnvHandlers } from "./agent_env";
import { registerAgentSessionHandlers } from "./agent_session";
import { registerChatHandlers } from "./chat";
import { registerEmployeeHandlers } from "./employee";
import { registerMcpHandlers } from "./mcp";
import { registerMessageHandlers } from "./message";
import { registerSessionHandlers } from "./session";
import { registerSettingsHandlers } from "./settings";
import { registerThemeHandlers } from "./theme";
import { registerWindowHandlers } from "./window";
import { registerWorkdirHandlers } from "./workdir";

/** Register all renderer ↔ main IPC channels. */
export function registerIpcHandlers(): void {
  registerSettingsHandlers();
  registerWorkdirHandlers();
  registerThemeHandlers();
  registerWindowHandlers();
  registerChatHandlers();
  registerMessageHandlers();
  registerMcpHandlers();
  registerAgentEnvHandlers();
  registerAgentSessionHandlers();
  registerEmployeeHandlers();
  registerSessionHandlers();
}
