import type { ThemeMode } from "../../shared/types";

/**
 * Renderer theme helpers: the 12 accent presets and the CSS-variable
 * injection that drives the app's color accent (mirrors the prototype's
 * `applyThemeAccent`). Mode persistence lives in the main process
 * (`theme:set` → nativeTheme), the renderer only re-applies the attribute
 * for explicit light/dark and lets `prefers-color-scheme` do the rest.
 */

export interface ThemeColor {
  id: string;
  hex: string;
}

export const THEME_COLORS: ThemeColor[] = [
  { id: "Emerald", hex: "#07C160" },
  { id: "Ocean", hex: "#3370FF" },
  { id: "Amber", hex: "#F58220" },
  { id: "Rose", hex: "#FA5151" },
  { id: "Lavender", hex: "#8B5CF6" },
  { id: "Teal", hex: "#0EA5E9" },
  { id: "Pink", hex: "#F472B6" },
  { id: "Slate", hex: "#64748B" },
  { id: "Forest", hex: "#22C55E" },
  { id: "Cobalt", hex: "#2563EB" },
  { id: "Coral", hex: "#FF6B6B" },
  { id: "Indigo", hex: "#4F46E5" },
];

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** Inject an accent preset as CSS variables (prototype-parity derivation). */
export function applyThemeAccent(hex: string): void {
  const { h, s, l } = hexToHsl(hex);
  const root = document.documentElement;
  root.style.setProperty("--imb-accent", hex);
  root.style.setProperty("--imb-accent-on", "#ffffff");
  root.style.setProperty(
    "--imb-accent-hover",
    `hsl(${h}, ${s}%, ${Math.min(l + 8, 95)}%)`,
  );
  root.style.setProperty(
    "--imb-accent-active",
    `hsl(${h}, ${s}%, ${Math.max(l - 10, 8)}%)`,
  );
  root.style.setProperty("--imb-success", hex);
  root.style.setProperty(
    "--imb-accent-soft",
    `color-mix(in oklch, ${hex} 14%, transparent)`,
  );
  root.style.setProperty(
    "--imb-focus-ring",
    `0 0 0 3px color-mix(in oklab, ${hex}, transparent 70%)`,
  );
}

/** Set/clear the `data-theme-mode` attribute (system = clear). */
export function applyThemeModeAttr(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme-mode");
  } else {
    root.setAttribute("data-theme-mode", mode);
  }
}
