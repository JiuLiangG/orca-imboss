import { chmodSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * Root of the app's dedicated data folder under the user's home directory.
 * Everything the app persists — SQLite database, avatars and Pi SDK
 * environment files (skills, auth, models, sessions) — lives here, isolated
 * from Electron's default userData and from the host system's own Pi agent.
 */
export function getDataRoot(): string {
  return join(homedir(), ".imboss");
}

/** Path of the app's SQLite database file. */
export function getDbPath(): string {
  return join(getDataRoot(), "db", "imboss.db");
}

/** Root of the isolated Pi agent environment (used as the SDK's `agentDir`). */
export function getAgentRoot(): string {
  return join(getDataRoot(), "agent");
}

export function getAgentSkillsDir(): string {
  return join(getAgentRoot(), "skills");
}

/** Directory where Pi session files will live once runtime wiring lands. */
export function getAgentSessionsDir(): string {
  return join(getAgentRoot(), "sessions");
}

/** Directory where employee avatar files live (`<id>.<ext>`). */
export function getAvatarsDir(): string {
  return join(getDataRoot(), "avatars");
}

/** Path of the Pi provider-credentials file (`auth.json`). Keep 0600. */
export function getAuthPath(): string {
  return join(getAgentRoot(), "auth.json");
}

/** Path of the Pi custom provider/model definitions file (`models.json`). */
export function getModelsPath(): string {
  return join(getAgentRoot(), "models.json");
}

/** Path of the cmd for agent sessions. */
export function getWorkDir(): string {
  return join(getDataRoot(), "workdir");
}

/**
 * Create the full data-folder layout if missing and harden permissions.
 *
 * - Directories are created recursively; an existing tree is left untouched.
 * - On POSIX systems the `.imboss` root is chmod'd to owner-only (0700) on a
 *   best-effort basis: failures (e.g. filesystems without permission bits) are
 *   swallowed so first launch never hard-fails, while `mkdir` errors propagate
 *   because a missing data folder is unrecoverable for everything downstream.
 */
export function ensureDataDir(): void {
  const dirs = [
    getDataRoot(),
    join(getDataRoot(), "db"),
    getAvatarsDir(),
    getAgentRoot(),
    getAgentSkillsDir(),
    getAgentSessionsDir(),
    getWorkDir(),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  if (process.platform !== "win32") {
    try {
      chmodSync(getDataRoot(), 0o700);
    } catch {
      // Best-effort hardening only — see doc comment above.
    }
  }
}
