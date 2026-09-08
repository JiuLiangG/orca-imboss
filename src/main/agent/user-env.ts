import { SettingKeys } from "@shared/constants/settings";
import { getSetting } from "../db/settings";

/**
 * User-configured environment variables (Settings → General → "Environment
 * variables"), applied at runtime to every subprocess the agent spawns:
 * the Pi shell tools (bash / PowerShell) and stdio MCP servers.
 *
 * Design (confirmed):
 * - Precedence: `{ ...process.env, ...resolvedUserEnv, ...specificEnv }` —
 *   global user env overrides process defaults; per-server / per-tool env
 *   overrides the global user env.
 * - Expansion: each value is expanded once using `expandValue` against
 *   `process.env` only. There are no user-var-to-user-var references.
 * - Validation: keys must look like env-var names and lengths are capped,
 *   mirroring the MCP service (`src/main/db/mcp.ts`).
 */

interface UserEnvEntry {
  key: string;
  value: string;
}

const MAX_ENTRIES = 128;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_LENGTH = 4096;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Cache of the last raw setting value → fully expanded env record. */
let cachedRaw: string | null | undefined;
let cachedRecord: Record<string, string> = {};

/**
 * Read + expand the user-configured environment variables for subprocesses.
 *
 * The result is cached against the raw settings value, so repeated calls per
 * spawned command stay cheap; any `settings:set("env", ...)` write invalidates
 * it automatically on the next read.
 */
export function readUserEnv(
  baseEnv: Record<string, string> = process.env as Record<string, string>,
): Record<string, string> {
  const raw = getSetting(SettingKeys.UserEnv);
  if (raw !== cachedRaw) {
    const record: Record<string, string> = {};
    for (const { key, value } of parseUserEnv(raw)) {
      record[key] = expandValue(value, baseEnv);
    }
    cachedRaw = raw;
    cachedRecord = record;
  }
  return cachedRecord;
}

/**
 * Merge env layers in precedence order — later layers win:
 * `mergeEnv(process.env, userEnv, serverEnv)` keeps `process.env` as the
 * lowest layer (so binaries stay findable via `$PATH`) while user env
 * overrides it and per-server / per-tool env wins over both.
 */
export function mergeEnv(
  ...layers: Array<Record<string, string> | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Expand `$VAR` / `${VAR}` references against `env`:
 * - `$VAR` and `${VAR}` are replaced when the variable exists in `env`;
 * - a referenced-but-missing variable is left **literally** unchanged;
 * - `$$` produces a literal `$`.
 *
 * This is a pure scanner (no shell evaluation), so expansion can never
 * execute anything — env values stay inert data.
 */
function expandValue(value: string, env: Record<string, string>): string {
  if (value.indexOf("$") < 0) return value;

  let out = "";
  let i = 0;
  const n = value.length;
  while (i < n) {
    const ch = value[i];
    if (ch !== "$") {
      out += ch;
      i += 1;
      continue;
    }

    const next = value[i + 1];
    if (next === "$") {
      // `$$` → literal `$`.
      out += "$";
      i += 2;
      continue;
    }
    if (next === "{") {
      const end = value.indexOf("}", i + 2);
      if (end < 0) {
        // Unbalanced → leave the token as written.
        out += ch;
        i += 1;
        continue;
      }
      const name = value.slice(i + 2, end);
      if (
        isValidEnvName(name) &&
        Object.prototype.hasOwnProperty.call(env, name)
      ) {
        out += env[name];
      } else {
        out += value.slice(i, end + 1);
      }
      i = end + 1;
      continue;
    }
    if (next !== undefined && isNameStart(next)) {
      let j = i + 1;
      while (j < n && isNameChar(value[j])) j += 1;
      const name = value.slice(i + 1, j);
      if (Object.prototype.hasOwnProperty.call(env, name)) {
        out += env[name];
      } else {
        out += value.slice(i, j);
      }
      i = j;
      continue;
    }
    // A lone `$` not followed by a name → literal.
    out += ch;
    i += 1;
  }
  return out;
}

function isNameStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function isNameChar(ch: string): boolean {
  return isNameStart(ch) || (ch >= "0" && ch <= "9");
}

function isValidEnvName(name: string): boolean {
  return (
    name.length > 0 && name.length <= MAX_KEY_LENGTH && ENV_KEY_RE.test(name)
  );
}

/**
 * Parse the raw settings payload into a validated entry list. Malformed rows
 * are dropped defensively; everything is capped like the MCP service.
 */
function parseUserEnv(raw: string | null): UserEnvEntry[] {
  if (raw === null || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: UserEnvEntry[] = [];
  for (const item of (parsed as unknown[]).slice(0, MAX_ENTRIES)) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const key = typeof record["key"] === "string" ? record["key"] : "";
    const value = typeof record["value"] === "string" ? record["value"] : "";
    if (!isValidEnvName(key)) continue;
    if (value.length > MAX_VALUE_LENGTH) continue;
    entries.push({ key, value });
  }
  return entries;
}
