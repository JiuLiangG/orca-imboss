import { SettingKeys } from "@shared/constants/settings";
import type { WorkDirState } from "@shared/types";
import { mkdirSync } from "fs";
import { isAbsolute } from "path";
import { getWorkDir } from "../data-dir";
import { getSetting } from "../db/settings";

/**
 * Resolve the working directory (cwd) used by every agent session.
 *
 * The value is user-configured via Settings → General → "Working directory"
 * (`agent.workdir`). Rules:
 * - unset/blank → the app's default `~/.imboss/workdir`;
 * - a non-absolute path is rejected (logged) and the default is used;
 * - a missing directory is re-created (`mkdir -p`) so the configured path stays
 *   authoritative and self-heals after the user deletes it;
 * - any failure falls back to the default rather than failing the session.
 *
 * Resolution is intentionally uncached: a cheap `mkdir` per session compose
 * keeps the self-heal guarantee valid (see `.pi/facts/workdir-setting.md`).
 */
export function resolveWorkDir(): string {
  const fallback = getWorkDir();
  const configured = getSetting(SettingKeys.WorkDir)?.trim();
  if (!configured) return fallback;
  if (!isAbsolute(configured)) {
    console.error(
      `[workdir] Ignoring non-absolute working directory: ${configured}`,
    );
    return fallback;
  }
  try {
    mkdirSync(configured, { recursive: true });
  } catch (err) {
    console.error(
      `[workdir] Failed to ensure working directory ${configured}:`,
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
  return configured;
}

/** Renderer-facing snapshot of the working directory setting. */
export function getWorkDirState(): WorkDirState {
  const configured = getSetting(SettingKeys.WorkDir)?.trim() || null;
  return {
    configured,
    effective: resolveWorkDir(),
    isDefault: configured === null,
  };
}
