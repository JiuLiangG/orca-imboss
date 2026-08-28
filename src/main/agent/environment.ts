import { getAgentRoot } from "../data-dir";

export interface AgentEnvironment {
  rootDir: string;
}

/**
 * Return the app's *own* Pi environment location under `~/.imboss/agent`,
 * isolated from the host system's Pi agent (i.e. never `~/.pi/agent`).
 *
 * Directory layout managed by this app:
 *   - auth.json     → provider credentials (see agent/providers.ts)
 *   - models.json   → custom providers/models (see agent/providers.ts)
 *   - skills/       → installed skills (see agent/skills.ts)
 *   - sessions/     → Pi session files (used once runtime wiring lands)
 *
 * TODO(agent): When wiring the Pi SDK, configure it against these paths, e.g.
 *   - `SessionManager.create(cwd, sessionsDir)` for persisted chat sessions
 *   - `SettingsManager.inMemory({...})`
 *   - `ModelRuntime.create({ authPath: auth.json, modelsPath: models.json })`
 *   - `DefaultResourceLoader({ agentDir: rootDir, cwd, ... })`
 */
export function getAgentEnvironment(): AgentEnvironment {
  return { rootDir: getAgentRoot() };
}
