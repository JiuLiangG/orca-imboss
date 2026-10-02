import { registerAgentSessionHandlers } from "./agent_session";
import { registerChatHandlers } from "./chat";
import { registerEmployeeHandlers } from "./employee";
import { registerMcpHandlers } from "./mcp";
import { registerMessageHandlers } from "./message";
import { registerProviderHandlers } from "./provider";
import { registerSessionHandlers } from "./session";
import { registerSettingsHandlers } from "./settings";
import { registerSkillHandlers } from "./skill";
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
  registerProviderHandlers();
  registerSkillHandlers();
  registerMcpHandlers();
  registerAgentSessionHandlers();
  registerEmployeeHandlers();
  registerSessionHandlers();
}
