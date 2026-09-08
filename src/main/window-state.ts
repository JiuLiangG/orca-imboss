import { SettingKeys } from "@shared/constants/settings";
import { screen, type BrowserWindow } from "electron";
import { getSetting, setSetting } from "./db/settings";

// Window state persistence: stores the main window's normal (unmaximized) bounds
// so they can be restored on the next launch. Persisted via the DB `settings` KV
// table under the `ui.window` key as a JSON `{x,y,width,height}` string (CSS px).

export const DEFAULT_WINDOW_WIDTH = 950;
export const DEFAULT_WINDOW_HEIGHT = 670;
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Load and validate the persisted window bounds.
 *
 * Returns the bounds to (re)apply, or `null` when there is no usable saved state:
 * missing or corrupt record, size below the configured minimum, or the saved
 * position+size no longer fits inside any currently-connected display's work area
 * (e.g. the monitor was disconnected). The caller then falls back to the defaults
 * and lets Electron center the window on the primary display.
 */
export function loadWindowBounds(): WindowBounds | null {
  const stored = getSetting(SettingKeys.WindowState);
  if (!stored) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const x = record["x"];
  const y = record["y"];
  const width = record["width"];
  const height = record["height"];
  if (
    !isSafeInteger(x) ||
    !isSafeInteger(y) ||
    !isSafeInteger(width) ||
    !isSafeInteger(height)
  ) {
    return null;
  }

  const candidate: WindowBounds = { x, y, width, height };
  if (
    candidate.width < MIN_WINDOW_WIDTH ||
    candidate.height < MIN_WINDOW_HEIGHT
  ) {
    return null;
  }

  // The saved bounds must still fit inside a currently-connected display's work
  // area. This covers both "the display no longer exists" and "position plus size
  // is now out of display range" → the caller falls back to defaults.
  for (const display of screen.getAllDisplays()) {
    if (isContained(display.workArea, candidate)) return candidate;
  }
  return null;
}

/** Persist the window's normal (unmaximized) bounds when it closes. */
export function saveWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const { x, y, width, height } = win.getNormalBounds();
  if (width <= 0 || height <= 0) return;
  setSetting(SettingKeys.WindowState, JSON.stringify({ x, y, width, height }));
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isContained(
  workArea: { x: number; y: number; width: number; height: number },
  bounds: WindowBounds,
): boolean {
  return (
    bounds.x >= workArea.x &&
    bounds.y >= workArea.y &&
    bounds.x + bounds.width <= workArea.x + workArea.width &&
    bounds.y + bounds.height <= workArea.y + workArea.height
  );
}
