import { registerAgentSessionHandlers } from "./agent_session";
import { registerChatHandlers } from "./chat";
import { registerCronHandlers } from "./cron";
import { registerEmployeeHandlers } from "./employee";
import { registerMcpHandlers } from "./mcp";
import { registerMessageHandlers } from "./message";
import { registerMiniAppHandlers } from "./miniapps";
import { registerProviderHandlers } from "./provider";
import { registerSessionHandlers } from "./session";
import { registerSettingsHandlers } from "./settings";
import { registerSkillHandlers } from "./skill";
import { registerThemeHandlers } from "./theme";
import { registerUpdaterHandlers } from "./updater";
import { registerWindowHandlers } from "./window";
import { registerWorkdirHandlers } from "./workdir";

/** Register all renderer ↔ main IPC channels. */
export function registerIpcHandlers(): void {
  registerSettingsHandlers();
  registerWorkdirHandlers();
  registerThemeHandlers();
  registerWindowHandlers();
  registerUpdaterHandlers();
  registerChatHandlers();
  registerCronHandlers();
  registerMessageHandlers();
  registerProviderHandlers();
  registerSkillHandlers();
  registerMcpHandlers();
  registerMiniAppHandlers();
  registerAgentSessionHandlers();
  registerEmployeeHandlers();
  registerSessionHandlers();
}
