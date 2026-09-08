export type ThemeMode = "light" | "dark" | "system";

/** State pushed/returned by the theme IPC (`theme:get` / `theme:set`). */
export interface ThemeState {
  mode: ThemeMode;
  /** 6-digit hex accent color, e.g. `#07C160`. */
  color: string;
}

/** An installed skill under `~/.imboss/agent/skills/<name>/SKILL.md`. */
export interface InstalledSkill {
  name: string;
  /** Parsed from SKILL.md frontmatter when available. */
  description: string | null;
}
