/** Lifecycle of the app's auto-update state, mirrored from main to renderer. */
export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

/** Byte-level download progress (mirrors electron-updater's ProgressInfo). */
export interface UpdaterProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

/**
 * Complete updater state. Kept intentionally small and serializable so it can
 * be pushed over IPC on every transition and rendered directly.
 */
export interface UpdaterState {
  status: UpdaterStatus;
  /** Target version when one is available / downloading / downloaded. */
  version: string | null;
  progress: UpdaterProgress | null;
  error: string | null;
  /** Epoch ms of the last completed check (available or not), or null. */
  checkedAt: number | null;
}
