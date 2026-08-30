import { getAgentRoot } from "../data-dir";

export interface AgentEnvironment {
  rootDir: string;
}

/**
 * Return the app's *own* Pi environment location under `~/.imboss/agent`,
 * isolated from the host system's Pi agent (i.e. never `~/.pi/agent`).
 *
 * Directory layout managed by this app (used by the runtime wiring in
 * `src/main/agent/session.ts`):
 *   - auth.json     → provider credentials (see agent/providers.ts)
 *   - models.json   → custom providers/models (see agent/providers.ts)
 *   - skills/       → installed skills (see agent/skills.ts)
 *   - sessions/     → Pi session files (used once persistent sessions land;
 *                     the runtime currently uses `SessionManager.inMemory`)
 */
export function getAgentEnvironment(): AgentEnvironment {
  return { rootDir: getAgentRoot() };
}
