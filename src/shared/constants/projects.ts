import type { CommonProject, CommonProjectFolder } from "../types/projects";
import { normalizeTags } from "./tags";

/**
 * Common projects (Settings › Common projects). The list is stored as a JSON
 * string in the `settings` table (`app.commonProjects`) and read back through
 * the `projects:list` IPC, where the stored value is treated as untrusted and
 * re-normalized.
 */

/** Maximum length of a project name, in characters, after normalization. */
export const MAX_PROJECT_NAME_LENGTH = 64;

/** Maximum number of configured projects. */
export const MAX_PROJECTS = 50;

/** Maximum length of a project folder path (mirrors the attachment limit). */
export const MAX_PROJECT_FOLDER_PATH_LENGTH = 4096;

/** Maximum length of a generated project id. */
export const MAX_PROJECT_ID_LENGTH = 64;

/**
 * Normalize a raw project name: collapse control characters and runs of
 * whitespace, then trim and cap the length. Case is preserved.
 */
export function normalizeProjectName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROJECT_NAME_LENGTH)
    .trim();
}

/**
 * Platform-agnostic absolute-path check (POSIX, Windows drive and UNC). Folder
 * paths always originate from main's native picker; this guards against a
 * hand-edited settings value.
 */
function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith("\\\\")
  );
}

/** Basename of a path, used as the display name when none was supplied. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** Validate + normalize the folder part; `null` when absent or malformed. */
function normalizeFolder(value: unknown): CommonProjectFolder | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (
    path.length === 0 ||
    path.length > MAX_PROJECT_FOLDER_PATH_LENGTH ||
    !isAbsolutePath(path)
  ) {
    return null;
  }
  const name = normalizeProjectName(
    typeof record.name === "string" ? record.name : "",
  );
  return { name: name.length > 0 ? name : basename(path), path };
}

/**
 * Normalize one raw project. Returns `null` when invalid: a project needs a
 * name and at least a folder or one tag (the requirement's "at least one").
 *
 * `index` only feeds the fallback id used when the stored value has none.
 */
export function normalizeCommonProject(
  value: unknown,
  index = 0,
): CommonProject | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const name = normalizeProjectName(
    typeof record.name === "string" ? record.name : "",
  );
  if (name.length === 0) return null;
  const folder = normalizeFolder(record.folder);
  const tags = Array.isArray(record.tags)
    ? normalizeTags(
        record.tags.filter((tag): tag is string => typeof tag === "string"),
      )
    : [];
  if (folder === null && tags.length === 0) return null;
  const rawId = typeof record.id === "string" ? record.id.trim() : "";
  const id =
    rawId.length > 0
      ? rawId.slice(0, MAX_PROJECT_ID_LENGTH)
      : `common-project-${index + 1}`;
  return { id, name, folder, tags };
}

/**
 * Normalize a list of raw projects: per-item validation, drop duplicates by
 * name (first wins — project names must be unique) and cap to `MAX_PROJECTS`.
 */
export function normalizeCommonProjects(value: unknown): CommonProject[] {
  if (!Array.isArray(value)) return [];
  const result: CommonProject[] = [];
  const names = new Set<string>();
  for (const item of value) {
    const project = normalizeCommonProject(item, result.length);
    if (project === null || names.has(project.name)) continue;
    names.add(project.name);
    result.push(project);
    if (result.length >= MAX_PROJECTS) break;
  }
  return result;
}

/** Parse the stored JSON setting. Never throws; invalid entries are dropped. */
export function parseCommonProjects(raw: string | null): CommonProject[] {
  if (!raw) return [];
  try {
    return normalizeCommonProjects(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Serialize the list for the `settings` table (only known fields). */
export function serializeCommonProjects(
  projects: readonly CommonProject[],
): string {
  return JSON.stringify(
    projects.map((project) => ({
      id: project.id,
      name: project.name,
      folder: project.folder,
      tags: project.tags,
    })),
  );
}
