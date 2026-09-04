import { app } from "electron";
import { getSetting } from "./db/services/settings";

export function getResolvedLocale(): string {
  const stored = getSetting("locale");
  if (stored) {
    return stored;
  }
  return app.getLocale();
}
