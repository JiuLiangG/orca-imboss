import { AgentEnvironment } from "@shared/types";
import { getAgentRoot } from "../data-dir";

/**
 * Return the app's *own* Pi environment location under `~/.imboss/agent`,
 * isolated from the host system's Pi agent (i.e. never `~/.pi/agent`).
 */
export function getAgentEnvironment(): AgentEnvironment {
  return { rootDir: getAgentRoot() };
}
