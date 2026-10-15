import { existsSync, lstatSync, readdirSync } from "fs";
import { join } from "path";
import { getAgentSkillsDir, getDataRoot, getMiniAppsDir } from "../data-dir";

/**
 * What a backup contains, expressed as an allow-list: everything below is
 * copied, everything else under the data folder is left out. That keeps
 * regenerated artifacts (the code-shipped built-in skills, the model-catalog
 * cache, the database's WAL sidecars, the dev CSV export folder) out by
 * construction instead of by a list of exceptions that can drift.
 */
const DIRECTORIES = [
  "avatars",
  "attachments",
  "mini-apps",
  "workdir",
  "agent/skills",
  "agent/sessions",
  "integrations/media",
] as const;

/**
 * Single files carried in addition to the directories above. All of them can
 * hold secrets — `agent/auth.json` provider API keys, `agent/models.json` keys
 * for custom providers, `agent/mcp.json` MCP server env/headers,
 * `integrations.json` IM bot tokens — so a backup always contains credentials
 * in plain text by design (the UI warns about this on export).
 */
const FILES = [
  "agent/auth.json",
  "agent/models.json",
  "agent/mcp.json",
  "integrations.json",
] as const;

/** Archive path of the database snapshot (written from a live backup, not the file). */
export const DB_ARCHIVE_PATH = "db/imboss.db";

/** One file to store: `rel` is its `/`-separated path inside the archive. */
export interface BackupEntry {
  rel: string;
  abs: string;
}

/** Enumerate the files a backup should carry, in a stable order. */
export function collectBackupEntries(): BackupEntry[] {
  const root = getDataRoot();
  const entries: BackupEntry[] = [];

  for (const rel of DIRECTORIES) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    walk(abs, rel, entries);
  }

  for (const rel of FILES) {
    const abs = join(root, rel);
    if (existsSync(abs)) entries.push({ rel, abs });
  }

  return entries;
}

/**
 * Number of sub-folders directly inside `dir` (0 when it does not exist).
 * Folders are what the app enumerates: one per skill (`SKILL.md` inside) and
 * one per Mini App (`metadata.json` inside), so a stray file such as the
 * Mini Apps `index.json` ordering file is not counted as content.
 */
export function countDirectories(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    ).length;
  } catch {
    return 0;
  }
}

/** Skills and Mini Apps are counted as directories on disk, not table rows. */
export function countUserSkills(): number {
  return countDirectories(getAgentSkillsDir());
}

export function countMiniApps(): number {
  return countDirectories(getMiniAppsDir());
}

/**
 * Recurse into `absDir`, appending regular files. Symbolic links are skipped:
 * a link pointing outside the data folder (or back into it) would otherwise
 * duplicate data or loop.
 */
function walk(absDir: string, relDir: string, out: BackupEntry[]): void {
  let names: string[];
  try {
    names = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of names) {
    const abs = join(absDir, name);
    const rel = `${relDir}/${name}`;
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(abs);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walk(abs, rel, out);
    } else if (stat.isFile()) {
      out.push({ rel, abs });
    }
  }
}
