import { getDB } from "./index";

/** Read a single setting value, or `null` when absent. */
export function getSetting(key: string): string | null {
  const row = getDB()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Insert or update a single setting value (serialized write). */
export function setSetting(key: string, value: string): void {
  getDB()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}
