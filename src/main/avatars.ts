import {
  chmodSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { getAvatarsDir } from "./data-dir";

/**
 * Avatar file store under `~/.imboss/avatars/<employeeId>.<ext>`.
 *
 * Security posture:
 * - File names are derived from integer employee ids only — never from
 *   user-controlled strings — so path traversal is impossible by construction.
 * - Extensions are whitelisted.
 * - Writes are atomic (temp file + rename) and chmod 0600 on POSIX.
 *
 * The renderer displays an avatar by building an `imb-file:` URL from the stored
 * absolute path (`Employee.avatar`); this module never reads the bytes.
 */

const AVATAR_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
] as const;
type AvatarExt = (typeof AVATAR_EXTENSIONS)[number];

const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10 MB — plenty for an avatar

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

/**
 * Change key for an avatar file: its last-modified time in ms, or `null` when
 * the path is empty/unreadable. Busts the browser's image cache for an
 * `imb-file:` URL after a same-format re-upload (the path stays identical).
 */
export function avatarVersion(path: string | null): number | null {
  if (!path) return null;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

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
