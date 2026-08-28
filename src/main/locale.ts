import { app } from "electron";
import { DEFAULT_LOCALE } from "../shared/constants";
import { getSetting } from "./db/services/settings";

/**
 * Resolve the effective locale: DB override → system locale → English fallback.
 * The resolved value is pushed to the renderer, which re-runs `setupL10N`.
 */
export function getResolvedLocale(): string {
  const stored = getSetting("locale");
  if (stored) {
    return stored;
  }
  return app.getLocale();
}

export { DEFAULT_LOCALE };
