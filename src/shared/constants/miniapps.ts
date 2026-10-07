/**
 * Mini Apps constants shared by main and renderer. The service lives in
 * `src/main/mini-apps.ts`; the renderer only needs the app id shape (for
 * validation hints) and metadata limits.
 */

/** Per-app metadata file name. */
export const MINI_APP_METADATA_FILE = "metadata.json";

/** Sidebar order file name inside the mini-apps root. */
export const MINI_APP_INDEX_FILE = "index.json";

/** Folder-name shape that is accepted as a mini-app id. */
export const MINI_APP_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export const MINI_APP_NAME_MAX = 100;
export const MINI_APP_ENTRY_MAX = 2048;
export const MINI_APP_COMMAND_MAX = 2048;
export const MINI_APP_ARGS_MAX = 64;
export const MINI_APP_ARG_MAX = 1024;
export const MINI_APP_ARGS_TOTAL_MAX = 8192;
export const MINI_APP_ENV_MAX = 64;
export const MINI_APP_ENV_KEY_MAX = 256;
export const MINI_APP_ENV_VALUE_MAX = 4096;
export const MINI_APP_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Icon budgets (read into memory and returned as a data URL). */
export const MINI_APP_ICON_MAX_BYTES = 256 * 1024;
export const MINI_APP_ICON_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
];

/** Supervised-server readiness polling + restart policy. */
export const MINI_APP_SERVER_READY_TIMEOUT_MS = 30_000;
export const MINI_APP_SERVER_READY_INTERVAL_MS = 500;
export const MINI_APP_SERVER_MAX_RESTARTS = 3;
