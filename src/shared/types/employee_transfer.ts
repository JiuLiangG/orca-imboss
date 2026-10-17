import type { ThinkingLevel } from "../constants/thinking";
import type { Employee } from "./employees";

/**
 * Types of the "export / import one employee" feature.
 *
 * An export is a plain zip (see `@shared/constants/employee_transfer` for the
 * layout) carrying the employee's own fields, the `mcp.json` entries of the
 * servers it links, and the folders of the skills it links.
 *
 * Two deliberate restrictions:
 * - The employee's **id** is never imported: the row id is local (chats,
 *   sessions and cron jobs reference it), so an import always creates a new
 *   employee and rewrites every id reference.
 * - MCP `env` / `headers` **values** are blanked on export (keys kept), because
 *   the zip is a file users copy around; the keys are listed so the importer
 *   knows exactly what to fill in again.
 */

/** Employee fields carried by an export (no id, no local avatar path). */
export interface EmployeeExportRecord {
  name: string;
  role: string;
  systemPrompt: string;
  /** Linked MCP server names, plus `builtin:*` opt-in markers. */
  mcp: string[];
  /** Linked user skill folder names. */
  skills: string[];
  modelId: string | null;
  thinkingLevel: ThinkingLevel | null;
  /** Archive-relative path of the avatar image, or null when there is none. */
  avatar: string | null;
}

/** Summary of one skill folder stored in the archive. */
export interface EmployeeExportSkillInfo {
  name: string;
  files: number;
  bytes: number;
}

/** `imboss-employee.json` — the archive's identity and payload. */
export interface EmployeeExportManifest {
  format: "imboss-employee";
  /** `EMPLOYEE_EXPORT_FORMAT_VERSION` of the writer. */
  formatVersion: number;
  appVersion: string;
  createdAt: number;
  platform: string;
  /** Id on the exporting machine (informational only; never applied). */
  sourceEmployeeId: number;
  employee: EmployeeExportRecord;
  /**
   * Raw `mcp.json` entries of the linked servers, verbatim except for
   * `env`/`headers` values which are blanked.
   */
  mcpServers: Record<string, unknown>;
  skills: EmployeeExportSkillInfo[];
  /**
   * Per MCP server: the secret keys whose value was blanked, e.g.
   * `{ "github": ["env.GITHUB_TOKEN", "headers.Authorization"] }`.
   */
  clearedSecrets: Record<string, string[]>;
  /** Non-fatal problems noticed while exporting (missing MCP/skill, …). */
  warnings: string[];
}

/** What `employees:export` hands back to the renderer (null = cancelled). */
export interface EmployeeExportResult {
  path: string;
  sizeBytes: number;
  files: number;
  bytes: number;
  included: {
    mcp: string[];
    skills: string[];
  };
  clearedSecrets: Record<string, string[]>;
  warnings: string[];
}

/** One skill folder found in a package, as shown in the preview dialog. */
export interface EmployeeImportPreviewSkill {
  name: string;
  files: number;
  bytes: number;
  /** A skill folder of this name already exists locally. */
  exists: boolean;
  /** Set when the folder cannot be installed (invalid name / no SKILL.md). */
  invalidReason: string | null;
}

/** One MCP server found in a package, as shown in the preview dialog. */
export interface EmployeeImportPreviewMcpServer {
  name: string;
  transport: "stdio" | "http";
  /** Short endpoint summary: the command line or the URL. */
  target: string;
  /** A server of this name already exists locally. */
  exists: boolean;
  /** Blanked secret keys the user must fill in, e.g. `env.TOKEN`. */
  secretKeys: string[];
}

/** Identity/copy of the manifest fields shown in the preview dialog. */
export interface EmployeeImportPreviewManifest {
  formatVersion: number;
  appVersion: string;
  createdAt: number;
  platform: string;
  sourceEmployeeId: number;
  /** Warnings recorded by the exporter. */
  warnings: string[];
}

/**
 * Result of `employees:importInspect`: everything needed to render the
 * confirmation dialog. `token` identifies the unpacked staging copy on disk;
 * it expires (see `EmployeeImportApplyOptions`).
 */
export interface EmployeeImportPreview {
  token: string;
  /** Folder name of the package that was picked (shown for reassurance). */
  sourceName: string;
  /** Epoch ms after which this staging copy is discarded. */
  expiresAt: number;
  manifest: EmployeeImportPreviewManifest;
  employee: {
    name: string;
    role: string;
    mcp: string[];
    skills: string[];
    modelId: string | null;
    thinkingLevel: ThinkingLevel | null;
    /**
     * Preview-only `data:` URL of the package avatar, so the confirmation
     * dialog can show it. `null` when the package has no avatar, it exceeds
     * the preview size cap, or its bytes are not a decodable image.
     * Images are only ever rendered from a whitelisted MIME type derived from
     * the file's magic bytes — never from the member name.
     */
    avatarDataUrl: string | null;
  };
  skills: EmployeeImportPreviewSkill[];
  mcpServers: EmployeeImportPreviewMcpServer[];
  /** Linked MCP names that are neither in the package nor installed locally. */
  missingMcp: string[];
  /** Linked skill names that are neither in the package nor installed locally. */
  missingSkills: string[];
  /** Set when the exported `modelId` cannot be resolved on this machine. */
  modelFallback: { from: string } | null;
  /** True when at least one skill or MCP server already exists locally. */
  hasConflicts: boolean;
}

/** Options of the apply step (already confirmed by the user). */
export interface EmployeeImportApplyOptions {
  /** Replace locally existing skills / MCP servers of the same name. */
  overwrite: boolean;
}

/** What `employees:importApply` hands back to the renderer. */
export interface EmployeeImportResult {
  employee: Employee;
  skills: {
    /** Newly copied in. */
    installed: string[];
    /** Replaced because "overwrite" was chosen. */
    overwritten: string[];
    /** Left untouched because a folder of that name already existed. */
    kept: string[];
    /** Dropped (no SKILL.md / invalid name) — see `warnings`. */
    skipped: string[];
  };
  mcp: {
    added: string[];
    overwritten: string[];
    kept: string[];
    /** Dropped: invalid entry, or the server is missing from the package. */
    missing: string[];
  };
  /** MCP servers whose credential values still need to be filled in. */
  secretsToFill: Record<string, string[]>;
  warnings: string[];
}
