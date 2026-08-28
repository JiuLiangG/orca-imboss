import { cpSync, existsSync, mkdirSync, statSync } from "fs";
import { readdir, readFile, rm } from "fs/promises";
import { basename, join, resolve } from "path";
import { getAgentSkillsDir } from "../data-dir";
import type { InstalledSkill } from "../../shared/types";

/**
 * Install / uninstall of skills under `~/.imboss/agent/skills/<name>/`.
 * A valid skill folder contains a `SKILL.md` (Agent Skills standard).
 * Local-folder import only this iteration (confirmed scope).
 */

const SKILL_FILE = "SKILL.md";

const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidSkillName(name: string): boolean {
  return SAFE_NAME_RE.test(name);
}

export async function listSkills(): Promise<InstalledSkill[]> {
  let entries: string[];
  try {
    entries = await readdir(getAgentSkillsDir());
  } catch {
    return [];
  }
  const installed: InstalledSkill[] = [];
  for (const name of entries) {
    if (!SAFE_NAME_RE.test(name)) continue;
    const dir = resolve(getAgentSkillsDir(), name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const skillFile = join(dir, SKILL_FILE);
      if (!existsSync(skillFile)) continue;
      installed.push({ name, description: await readDescription(skillFile) });
    } catch {
      continue;
    }
  }
  return installed.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Best-effort extraction of the `description:` line from SKILL.md YAML
 * frontmatter. Purely informational (list UI); malformed files simply yield
 * `null` rather than failing the listing.
 */
async function readDescription(skillFilePath: string): Promise<string | null> {
  try {
    const head = (await readFile(skillFilePath, "utf8")).slice(0, 4096);
    const match = /^description:\s*(.+)$/m.exec(head);
    if (!match) return null;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    return value.length > 0 ? value.slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** Import a local folder as a skill; requires a `SKILL.md` inside. */
export function installSkillFromFolder(sourcePath: string): string {
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    throw new Error("Source path is required.");
  }
  const src = resolve(sourcePath);
  let srcIsDirectory = false;
  try {
    srcIsDirectory = statSync(src).isDirectory();
  } catch {
    throw new Error("Source folder does not exist.");
  }
  if (!srcIsDirectory) {
    throw new Error("Source path is not a folder.");
  }

  const name = basename(src);
  if (!isValidSkillName(name)) {
    throw new Error(
      'Folder name must use letters, digits, ".", "_" or "-" only.',
    );
  }

  const root = getAgentSkillsDir();
  mkdirSync(root, { recursive: true });
  // `name` has no separators (SAFE_NAME_RE), so join() stays inside the root.
  const dest = join(resolve(root), name);
  if (existsSync(dest)) {
    throw new Error(`Skill "${name}" is already installed.`);
  }
  if (!existsSync(join(src, SKILL_FILE))) {
    throw new Error("Source folder does not contain a SKILL.md.");
  }

  cpSync(src, dest, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  return name;
}

export async function uninstallSkill(name: string): Promise<void> {
  if (!isValidSkillName(name)) {
    throw new Error("Invalid skill name.");
  }
  const root = resolve(getAgentSkillsDir());
  const dest = resolve(root, name);
  // Containment: only ever delete direct children of the skills root.
  if (dest !== join(root, name)) {
    throw new Error("Refusing to delete outside the skills folder.");
  }
  await rm(dest, { recursive: true, force: true });
}
