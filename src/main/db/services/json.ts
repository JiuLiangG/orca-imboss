/**
 * Defensive helpers for the JSON-array TEXT columns (employees.tools,
 * employees.skills, chats.participants).
 *
 * Stored values are never trusted: parsing failures and malformed shapes
 * degrade to an empty array instead of throwing.
 */

/** Parse a stored JSON array of strings; anything unexpected becomes `[]`. */
export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function parseNumberArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => typeof item === "number");
  } catch {
    return [];
  }
}

/** Canonical stringified form used whenever arrays are written back. */
export function stringifyArray(values: readonly unknown[]): string {
  return JSON.stringify(values);
}

/** Parse a stored JSON object; anything unexpected becomes `{}`. */
export function parseJsonObject(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
