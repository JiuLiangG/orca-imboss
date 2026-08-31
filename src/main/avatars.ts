import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { extname, join } from "path";
import { getAvatarsDir } from "./data-dir";

/**
 * Avatar file store under `~/.imboss/avatars/<employeeId>.<ext>`.
 *
 * Security posture:
 * - File names are derived from integer employee ids only — never from
 *   user-controlled strings — so path traversal is impossible by construction.
 * - Extensions are whitelisted; reads never follow files outside the dir.
 * - Writes are atomic (temp file + rename) and chmod 0600 on POSIX.
 */

const AVATAR_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;
type AvatarExt = (typeof AVATAR_EXTENSIONS)[number];

const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10 MB — plenty for an avatar

const MIME_BY_EXT: Record<AvatarExt, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function validateEmployeeId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new Error("Invalid employee id.");
  }
}

function validateExt(ext: string): AvatarExt {
  const normalized = ext.toLowerCase().replace(/^\./, "");
  if (!(AVATAR_EXTENSIONS as readonly string[]).includes(normalized)) {
    throw new Error("Unsupported avatar format.");
  }
  return normalized as AvatarExt;
}

/** Existing avatar file for an employee, or null. */
function findAvatarFile(id: number): string | null {
  const dir = getAvatarsDir();
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // `name = employee id int` — match exactly, ignore anything else.
      if (entry === `${id}`) continue; // not a file we own
      const match = /^(\d+)\.([a-z]+)$/.exec(entry);
      if (!match || match[1] !== String(id)) continue;
      const ext = match[2].toLowerCase();
      if (!(AVATAR_EXTENSIONS as readonly string[]).includes(ext)) continue;
      const file = join(dir, entry);
      if (existsSync(file)) return file;
    }
  } catch {
    // Missing/corrupt dir → no avatar.
  }
  return null;
}

/**
 * Persist an avatar image for an employee. Replaces any previous avatar
 * (regardless of format). Returns the stored absolute path.
 */
export function saveAvatar(id: number, ext: string, data: Buffer): string {
  validateEmployeeId(id);
  const safeExt = validateExt(ext);
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error("Avatar data is required.");
  }
  if (data.length > MAX_AVATAR_BYTES) {
    throw new Error("Avatar image is too large (max 10 MB).");
  }

  const dir = getAvatarsDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${id}.${safeExt}`);

  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, dest);
  if (process.platform !== "win32") {
    try {
      chmodSync(dest, 0o600);
    } catch {
      // Best-effort hardening only.
    }
  }

  // Remove leftovers with other extensions for the same id.
  for (const entry of readdirSync(dir)) {
    const match = /^(\d+)\.([a-z]+)$/.exec(entry);
    if (!match || match[1] !== String(id) || join(dir, entry) === dest)
      continue;
    try {
      rmSync(join(dir, entry), { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
  return dest;
}

/** Remove every avatar file belonging to an employee (id-based lookup). */
export function deleteAvatarFiles(id: number): void {
  validateEmployeeId(id);
  const dir = getAvatarsDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const match = /^(\d+)\.([a-z]+)$/.exec(entry);
    if (!match || match[1] !== String(id)) continue;
    try {
      rmSync(join(dir, entry), { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

/** Read an employee's avatar as a data URL, or null when absent. */
export function readAvatarDataUrl(id: number): string | null {
  validateEmployeeId(id);
  const file = findAvatarFile(id);
  if (!file) return null;
  const ext = extname(file).slice(1).toLowerCase() as AvatarExt;
  const mime = MIME_BY_EXT[ext] ?? "image/png";
  try {
    const data = readFileSync(file);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}
