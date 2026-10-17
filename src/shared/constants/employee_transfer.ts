/**
 * Archive layout of a single-employee export ("zip of one employee").
 *
 * ```
 * imboss-employee.json      # manifest (the only required member)
 * avatar/avatar.<ext>       # optional avatar image bytes
 * skills/<skillName>/...    # one folder per linked skill, verbatim
 * ```
 *
 * Kept in `shared/constants` so main (writer/reader) and renderer (dialog copy)
 * agree without importing main-process code.
 */

/** Manifest `format` marker; anything else is not one of our exports. */
export const EMPLOYEE_EXPORT_FORMAT = "imboss-employee";

/**
 * Bumped only when the archive layout or manifest shape changes incompatibly.
 * A package with a greater value than this build understands is rejected.
 */
export const EMPLOYEE_EXPORT_FORMAT_VERSION = 1;

/** Extension used by the save/open dialogs. */
export const EMPLOYEE_EXPORT_EXTENSION = "zip";

/** Archive-relative path of the manifest. */
export const EMPLOYEE_MANIFEST_PATH = "imboss-employee.json";

/** Archive-relative folder holding the avatar image. */
export const EMPLOYEE_AVATAR_DIR = "avatar";

/** Archive-relative folder holding one sub-folder per skill. */
export const EMPLOYEE_SKILLS_DIR = "skills";

/** Prefix of MCP markers that name code-shipped tools, not `mcp.json` servers. */
export const BUILTIN_MCP_MARKER_PREFIX = "builtin:";
