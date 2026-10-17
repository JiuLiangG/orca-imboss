import { isAbsolute, join, resolve, sep } from "path";
import {
  EMPLOYEE_AVATAR_DIR,
  EMPLOYEE_MANIFEST_PATH,
  EMPLOYEE_SKILLS_DIR,
} from "@shared/constants/employee_transfer";

/**
 * Path handling for employee export packages.
 *
 * Everything here treats archive member names as **untrusted input**: a zip can
 * name a member `../../etc/passwd`, use backslashes, embed a drive letter, carry
 * Windows-reserved device names or control characters. All of those are rejected
 * before any byte is written, and the final destination is re-checked with
 * `resolve()` so it can never escape the staging root.
 */

/** Top-level members a package may carry; everything else is ignored. */
export const ALLOWED_TOP_LEVEL = [
  EMPLOYEE_MANIFEST_PATH,
  EMPLOYEE_AVATAR_DIR,
  EMPLOYEE_SKILLS_DIR,
] as const;

/** Avatar formats the avatar store accepts (mirror of `src/main/avatars.ts`). */
const AVATAR_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
] as const;

/** Windows device names, reserved regardless of extension. */
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;

/**
 * True when a zip member name is a safe, portable relative path:
 * `/`-separated, no empty/`.`/`..` segments, no absolute path, no drive letter,
 * no backslash, no NUL/control characters, no Windows-illegal characters, no
 * trailing dot/space and no reserved device name.
 */
export function isSafeEntryPath(name: string): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.length > MAX_PATH_LENGTH) return false;
  // Windows separators and drive letters never appear in a portable zip.
  if (name.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  if (isAbsolute(name)) return false;
  // Control characters (including NUL) are never legitimate in a path.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;

  const segments = name.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return false;
    }
    if (segment.length > MAX_SEGMENT_LENGTH) return false;
    if (/[<>:"|?*]/.test(segment)) return false;
    if (/[. ]$/.test(segment)) return false;
    const base = segment.split(".")[0]?.toLowerCase() ?? "";
    if (WINDOWS_RESERVED_NAMES.has(base)) return false;
  }
  return true;
}

/**
 * Resolve `rel` below `root`, throwing when the result is not inside it.
 * The caller must already have validated `rel` with `isSafeEntryPath`.
 */
export function resolveInside(root: string, rel: string): string {
  const base = resolve(root);
  const abs = resolve(join(base, ...rel.split("/")));
  if (abs !== base && !abs.startsWith(`${base}${sep}`)) {
    throw new Error(`Refusing to write outside the destination folder: ${rel}`);
  }
  return abs;
}

/** True when the member belongs to the package layout we understand. */
export function isPackageMember(name: string): boolean {
  const top = name.split("/")[0];
  return (ALLOWED_TOP_LEVEL as readonly string[]).includes(top);
}

/** Skill name of a `skills/<name>/...` member (null when not one). */
export function skillNameOfMember(name: string): string | null {
  const segments = name.split("/");
  if (segments[0] !== EMPLOYEE_SKILLS_DIR || segments.length < 2) return null;
  return segments[1];
}

/** Path-relative part below `skills/<name>/` (null when not applicable). */
export function skillRelativePath(name: string): string | null {
  const segments = name.split("/");
  if (segments[0] !== EMPLOYEE_SKILLS_DIR || segments.length < 3) return null;
  return segments.slice(2).join("/");
}

/**
 * Make a value safe to embed in a suggested file name: letters, digits, `-`
 * and `_` survive, everything else (including `.` and spaces) becomes `_`.
 */
export function sanitizeFileNamePart(value: string, fallback: string): string {
  const cleaned = (value ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Lowercase avatar extension of a path, when it is one we accept. */
export function avatarExtensionOf(filePath: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(filePath);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return (AVATAR_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

/**
 * Sniff an image extension from the file's magic bytes (the archive only ever
 * carries images the avatar store produced, but the extension is authoritative
 * input for that store, so it is re-derived rather than trusted).
 */
export function detectImageExtension(data: Uint8Array): string | null {
  const at = (index: number, length: number): string =>
    String.fromCharCode(...data.subarray(index, index + length));
  if (data.length >= 8 && data[0] === 0x89 && at(1, 3) === "PNG") return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) return "jpg";
  if (data.length >= 6 && at(0, 4) === "GIF8") return "gif";
  if (data.length >= 12 && at(0, 4) === "RIFF" && at(8, 4) === "WEBP") {
    return "webp";
  }
  if (data.length >= 12 && at(4, 4) === "ftyp") {
    const brand = at(8, 4);
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return null;
}
