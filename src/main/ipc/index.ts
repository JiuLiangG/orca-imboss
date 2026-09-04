import { registerAgentEnvHandlers } from "./agent_env";
import { registerChatHandlers } from "./chat";
import { registerEmployeeHandlers } from "./employee";
import { registerMcpHandlers } from "./mcp";
import { registerMessageHandlers } from "./message";
import { registerSessionHandlers } from "./session";
import { registerSettingsHandlers } from "./settings";
import { registerThemeHandlers } from "./theme";
import { registerWindowHandlers } from "./window";

/** Register all renderer ↔ main IPC channels. */
export function registerIpcHandlers(): void {
  registerSettingsHandlers();
  registerThemeHandlers();
  registerWindowHandlers();
  registerChatHandlers();
  registerMessageHandlers();
  registerMcpHandlers();
  registerAgentEnvHandlers();
  registerEmployeeHandlers();
  registerSessionHandlers();
}
