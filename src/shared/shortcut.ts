/**
 * Accelerator helpers for the window show/hide hotkey, shared by the main
 * process (registering the OS-level shortcut) and the renderer (recording it
 * from a key event and displaying it with platform symbols).
 *
 * Pure functions only — no Electron / Node imports — so both bundles can use
 * this module.
 *
 * Canonical form: an Electron accelerator string such as
 * `CommandOrControl+Shift+Space`. The platform's primary modifier is always
 * stored as `CommandOrControl` (⌘ on macOS, Ctrl elsewhere), so a recorded value
 * keeps its meaning on every platform.
 */

/**
 * Defaults: macOS gets ⌘⌃B (the primary modifier combinations users expect —
 * ⌘Space, ⌘⇧Space — belong to the system), Windows / Linux get Ctrl+Alt+Shift+B,
 * which no OS / IME default owns.
 */
const DEFAULT_DARWIN = "CommandOrControl+Control+B";
const DEFAULT_OTHER = "CommandOrControl+Alt+Shift+B";

export type ShortcutRejectReason =
  /** Not a parseable accelerator string. */
  | "invalid"
  /** Only modifiers, or no modifier with a "command" meaning (Shift alone). */
  | "noModifier"
  /** Owned by the OS / desktop environment. */
  | "reserved"
  /** One of the app's own in-window shortcuts (⌘F / ⌘G / ⌘K). */
  | "appShortcut"
  /** The OS refused the registration — another app already holds it. */
  | "conflict";

export interface ParsedAccelerator {
  /** Canonical modifier names, in display order. */
  modifiers: string[];
  /** Canonical key name (`A`, `1`, `F5`, `Space`, `Up`, `Plus`, …). */
  key: string;
}

export type ShortcutValidation =
  | { ok: true; accelerator: string }
  | { ok: false; reason: Exclude<ShortcutRejectReason, "conflict"> };

/** The subset of a DOM `KeyboardEvent` this module needs (keeps it DOM-free). */
export interface ShortcutKeyboardEvent {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function isMacPlatform(platform: string): boolean {
  return platform === "darwin";
}

/** The built-in hotkey for `platform` (what "reset to default" uses). */
export function defaultWindowShortcut(platform: string): string {
  return isMacPlatform(platform) ? DEFAULT_DARWIN : DEFAULT_OTHER;
}

const MODIFIER_ORDER = [
  "CommandOrControl",
  "Command",
  "Control",
  "Alt",
  "AltGr",
  "Shift",
  "Super",
];

/** Modifiers that make a combination a "command" combination. */
const COMMAND_MODIFIERS = [
  "CommandOrControl",
  "Command",
  "Control",
  "Alt",
  "AltGr",
  "Super",
];

const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  commandorctrl: "CommandOrControl",
  cmdorcontrol: "CommandOrControl",
  command: "Command",
  cmd: "Command",
  meta: "Command",
  control: "Control",
  ctrl: "Control",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  altgr: "AltGr",
  shift: "Shift",
  super: "Super",
  win: "Super",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  return: "Enter",
  enter: "Enter",
  space: "Space",
  spacebar: "Space",
  plus: "Plus",
  up: "Up",
  arrowup: "Up",
  down: "Down",
  arrowdown: "Down",
  left: "Left",
  arrowleft: "Left",
  right: "Right",
  arrowright: "Right",
  del: "Delete",
  delete: "Delete",
  ins: "Insert",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  backspace: "Backspace",
  tab: "Tab",
  capslock: "Capslock",
  numlock: "Numlock",
  printscreen: "PrintScreen",
};

/**
 * Combinations the OS (or the desktop environment) owns: registering them would
 * either fail or steal a system-wide key from every other app.
 */
function reservedAccelerators(platform: string): Set<string> {
  const reserved = [
    "CommandOrControl+Q",
    "CommandOrControl+W",
    "CommandOrControl+Tab",
    "CommandOrControl+Shift+Tab",
    "CommandOrControl+Space",
    "CommandOrControl+Escape",
    "CommandOrControl+Alt+Delete",
  ];
  if (isMacPlatform(platform)) {
    reserved.push(
      "CommandOrControl+H",
      "CommandOrControl+M",
      "CommandOrControl+Alt+Escape",
      "Control+Space",
    );
  } else {
    reserved.push(
      "Alt+F4",
      "CommandOrControl+Shift+Escape",
      "CommandOrControl+Alt+Tab",
    );
  }
  return new Set(reserved);
}

/**
 * The app's own in-window shortcuts (thread find, chat search): a *global*
 * registration would swallow them here and in every other app.
 */
const APP_SHORTCUTS = new Set([
  "CommandOrControl+F",
  "CommandOrControl+G",
  "CommandOrControl+Shift+G",
  "CommandOrControl+K",
]);

function sortModifiers(modifiers: string[]): string[] {
  return [...modifiers].sort(
    (a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b),
  );
}

/**
 * Single punctuation characters Electron accepts as key names. Spelled out as a
 * set: a character-class regex for this is a quoting minefield (`/`, `[`, `]`).
 */
const PUNCTUATION_KEYS = new Set(
  "`-=[]\\;',./~!@#$%^&*()_+{}|:\"<>?".split(""),
);

function normalizeKey(token: string): string | null {
  const alias = KEY_ALIASES[token.toLowerCase()];
  if (alias !== undefined) return alias;
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]$/.test(token)) return token;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(token)) return token.toUpperCase();
  if (token.length === 1 && PUNCTUATION_KEYS.has(token)) return token;
  return null;
}

/** Parse a canonical (or alias-y) accelerator string; `null` when unusable. */
export function parseAccelerator(raw: unknown): ParsedAccelerator | null {
  if (typeof raw !== "string") return null;
  const parts = raw
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  // The plus *key* is spelled `Plus`, so every token here is meaningful.
  const key = normalizeKey(parts[parts.length - 1] as string);
  if (key === null) return null;

  const modifiers: string[] = [];
  for (const token of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    // Unknown token, or the same modifier twice (`Control+Control+B`).
    if (modifier === undefined || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }

  return { modifiers: sortModifiers(modifiers), key };
}

/** Canonicalize an accelerator; `null` when it cannot be parsed. */
export function normalizeAccelerator(raw: unknown): string | null {
  const parsed = parseAccelerator(raw);
  if (!parsed) return null;
  return [...parsed.modifiers, parsed.key].join("+");
}

/**
 * Validate a user-recorded accelerator. Deliberately permissive about the
 * modifier *combination* (any command modifier is fine — the OS is the final
 * authority on whether it can be registered), strict about the cases that
 * would break the system or this app.
 */
export function validateAccelerator(
  raw: unknown,
  platform: string,
): ShortcutValidation {
  const parsed = parseAccelerator(raw);
  if (!parsed) return { ok: false, reason: "invalid" };
  if (!parsed.modifiers.some((mod) => COMMAND_MODIFIERS.includes(mod))) {
    return { ok: false, reason: "noModifier" };
  }
  const accelerator = [...parsed.modifiers, parsed.key].join("+");
  if (reservedAccelerators(platform).has(accelerator)) {
    return { ok: false, reason: "reserved" };
  }
  if (APP_SHORTCUTS.has(accelerator)) {
    return { ok: false, reason: "appShortcut" };
  }
  return { ok: true, accelerator };
}

/** Map a `KeyboardEvent.code` to an Electron key name. */
function acceleratorKeyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

  switch (code) {
    case "Space":
      return "Space";
    case "Enter":
    case "NumpadEnter":
      return "Enter";
    case "Tab":
      return "Tab";
    case "Backspace":
      return "Backspace";
    case "Delete":
      return "Delete";
    case "Insert":
      return "Insert";
    case "Home":
      return "Home";
    case "End":
      return "End";
    case "PageUp":
      return "PageUp";
    case "PageDown":
      return "PageDown";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Backslash":
    case "IntlBackslash":
      return "\\";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Slash":
      return "/";
    case "Backquote":
      return "`";
    default:
      return null;
  }
}

/**
 * Build the canonical accelerator for a key press, or `null` when the press is
 * not usable on its own (a bare modifier, an unmapped key such as a media key,
 * or no modifier at all).
 *
 * `code` (physical key) is used instead of `key` so the result does not depend
 * on the keyboard layout or on Shift/AltGr character composition.
 */
export function acceleratorFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
  platform: string,
): string | null {
  const key = acceleratorKeyFromCode(event.code);
  if (key === null) return null;

  const modifiers: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) modifiers.push("CommandOrControl");
    if (event.ctrlKey) modifiers.push("Control");
  } else {
    if (event.ctrlKey) modifiers.push("CommandOrControl");
    if (event.metaKey) modifiers.push("Super");
  }
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (modifiers.length === 0) return null;

  return [...modifiers, key].join("+");
}

const MAC_MODIFIER_SYMBOLS: Record<string, string> = {
  CommandOrControl: "⌘",
  Command: "⌘",
  Super: "⌘",
  Control: "⌃",
  Alt: "⌥",
  AltGr: "⌥",
  Shift: "⇧",
};

const MAC_KEY_SYMBOLS: Record<string, string> = {
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Enter: "↩",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "⎋",
  PageUp: "⇞",
  PageDown: "⇟",
  Home: "↖",
  End: "↘",
};

const MAC_DISPLAY_ORDER = [
  "Control",
  "Alt",
  "AltGr",
  "Shift",
  "CommandOrControl",
  "Command",
  "Super",
];

/**
 * Human-readable label: `⌃⌘B` on macOS (Apple's modifier order), `Ctrl+Alt+Shift+B`
 * elsewhere. Falls back to the raw string when it cannot be parsed.
 */
export function formatAccelerator(
  accelerator: string | null,
  platform: string,
): string {
  if (!accelerator) return "";
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return accelerator;

  if (isMacPlatform(platform)) {
    const modifiers = [...parsed.modifiers].sort(
      (a, b) => MAC_DISPLAY_ORDER.indexOf(a) - MAC_DISPLAY_ORDER.indexOf(b),
    );
    const symbols = modifiers
      .map((modifier) => MAC_MODIFIER_SYMBOLS[modifier] ?? modifier)
      .join("");
    return symbols + (MAC_KEY_SYMBOLS[parsed.key] ?? parsed.key);
  }

  const modifiers = parsed.modifiers.map((modifier) =>
    modifier === "CommandOrControl" ||
    modifier === "Command" ||
    modifier === "Super"
      ? "Ctrl"
      : modifier,
  );
  return [...modifiers, parsed.key].join("+");
}
