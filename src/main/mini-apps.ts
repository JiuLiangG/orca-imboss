import {
  MINI_APP_ARG_MAX,
  MINI_APP_ARGS_MAX,
  MINI_APP_ARGS_TOTAL_MAX,
  MINI_APP_COMMAND_MAX,
  MINI_APP_ENV_KEY_MAX,
  MINI_APP_ENV_KEY_RE,
  MINI_APP_ENV_MAX,
  MINI_APP_ENV_VALUE_MAX,
  MINI_APP_ENTRY_MAX,
  MINI_APP_ICON_EXTENSIONS,
  MINI_APP_ICON_MAX_BYTES,
  MINI_APP_ID_RE,
  MINI_APP_INDEX_FILE,
  MINI_APP_METADATA_FILE,
  MINI_APP_NAME_MAX,
  MINI_APP_SERVER_MAX_RESTARTS,
  MINI_APP_SERVER_READY_INTERVAL_MS,
  MINI_APP_SERVER_READY_TIMEOUT_MS,
} from "@shared/constants/miniapps";
import type { MiniApp } from "@shared/types";
import { spawn, type ChildProcess } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "fs";
import { readdir } from "fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "path";
import { mergeEnv, readUserEnv } from "./agent/user-env";
import { getMiniAppsDir } from "./data-dir";

/**
 * Mini Apps service — the single source of truth for `~/.imboss/mini-apps`.
 *
 * Layout (one folder per app):
 *
 * ```
 * ~/.imboss/mini-apps/
 *   index.json                  # { "order": ["<id>", ...] } sidebar order
 *   <id>/metadata.json          # name, icon, entry + optional server command
 * ~/.imboss/mini-apps/<id>/icon.png
 * ```
 *
 * `metadata.json`:
 *
 * ```json
 * {
 *   "name": "World Map",
 *   "icon": "icon.png",
 *   "entry": "http://127.0.0.1:5173",
 *   "command": "npm",
 *   "args": ["run", "dev"],
 *   "cwd": ".",
 *   "env": { "PORT": "5173" }
 * }
 * ```
 *
 * Design (defensive):
 * - Reads never throw: a missing/corrupt `metadata.json` or `index.json`
 *   degrades to an empty/skipped entry so a bad folder can never break the app.
 * - Untrusted values are length-capped and shape-checked; the icon path and
 *   `cwd` are containment-checked against the app folder.
 * - The entry URL must be loopback http(s) (mini apps are local web servers).
 * - `command`/`args` are spawned with `shell: false` (no shell interpolation);
 *   `env` merges over `process.env` and the user env.
 * - Servers are started lazily on first open, kept until the app quits, and
 *   restarted (bounded) on unexpected exit.
 */

interface ParsedManifest {
  id: string;
  dir: string;
  name: string;
  entry: string;
  iconFile: string | null;
  command: string | null;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

interface RunningServer {
  child: ChildProcess;
  restarts: number;
  stopping: boolean;
}

const runningServers = new Map<string, RunningServer>();
const startingServers = new Map<string, Promise<void>>();
let quitting = false;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** All registered mini apps, ordered by `index.json` (new apps appended). */
export async function listMiniApps(): Promise<MiniApp[]> {
  const manifests = await scanManifests();
  const order = readIndexOrder();
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const ordered: MiniApp[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const manifest = byId.get(id);
    if (!manifest) continue;
    ordered.push(toMiniApp(manifest));
    seen.add(id);
  }
  const remaining = manifests
    .filter((manifest) => !seen.has(manifest.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const manifest of remaining) ordered.push(toMiniApp(manifest));
  return ordered;
}

/**
 * Rewrite `index.json` to the current app set: keep the existing order, append
 * newly discovered apps, and prune ids whose folder is gone. Best-effort.
 */
export async function syncMiniAppIndex(): Promise<void> {
  try {
    const manifests = await scanManifests();
    const byId = new Set(manifests.map((manifest) => manifest.id));
    const next: string[] = [];
    const seen = new Set<string>();
    for (const id of readIndexOrder()) {
      if (!byId.has(id) || seen.has(id)) continue;
      next.push(id);
      seen.add(id);
    }
    for (const manifest of manifests) {
      if (!seen.has(manifest.id)) next.push(manifest.id);
    }
    writeIndexOrder(next);
  } catch (err) {
    console.error(
      "[mini-apps] failed to sync index.json:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Persist a new sidebar order. Ids that are not currently registered are
 * dropped and any unlisted app is appended, so the stored order always matches
 * the live set. Returns the resulting list.
 */
export async function setMiniAppOrder(ids: string[]): Promise<MiniApp[]> {
  const manifests = await scanManifests();
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id) || !byId.has(id)) continue;
    next.push(id);
    seen.add(id);
  }
  for (const manifest of manifests) {
    if (!seen.has(manifest.id)) next.push(manifest.id);
  }
  writeIndexOrder(next);
  return listMiniApps();
}

/**
 * Ensure the mini app's server is running and reachable, then return it. When
 * the app defines a `command` it is started first; either way the entry URL is
 * polled until it answers (`connection refused` is treated as "not ready yet"
 * and retried) so the renderer never mounts the iframe against a dead server.
 * Throws when the app does not exist or its server never becomes ready.
 */
export async function openMiniApp(id: string): Promise<MiniApp> {
  const manifest = readManifest(id);
  if (!manifest) throw new Error(`Mini app "${id}" was not found.`);
  if (manifest.command !== null) {
    await ensureServer(manifest);
  } else {
    await waitForServer(manifest.entry);
  }
  return toMiniApp(manifest);
}

/** Stop every supervised server (called on app quit). Idempotent. */
export function stopAllMiniAppServers(): void {
  quitting = true;
  for (const server of runningServers.values()) {
    server.stopping = true;
    killProcessTree(server.child);
  }
  runningServers.clear();
  startingServers.clear();
}

// ---------------------------------------------------------------------------
// scanning / parsing
// ---------------------------------------------------------------------------

async function scanManifests(): Promise<ParsedManifest[]> {
  const root = getMiniAppsDir();
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests: ParsedManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (!MINI_APP_ID_RE.test(id)) continue;
    const manifest = readManifest(id);
    if (manifest) manifests.push(manifest);
  }
  return manifests;
}

/** Read + validate one app's `metadata.json`; `null` when absent/invalid. */
function readManifest(id: string): ParsedManifest | null {
  if (!MINI_APP_ID_RE.test(id)) return null;
  const root = resolve(getMiniAppsDir());
  const dir = resolve(root, id);
  if (!isInside(root, dir)) return null;

  const metadataPath = join(dir, MINI_APP_METADATA_FILE);
  if (!existsSync(metadataPath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (err) {
    console.error(
      `[mini-apps] failed to parse ${id}/${MINI_APP_METADATA_FILE}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;

  const name = readString(record["name"], MINI_APP_NAME_MAX).trim();
  if (name.length === 0) return null;

  const entry = readString(record["entry"], MINI_APP_ENTRY_MAX).trim();
  if (!isLoopbackHttpUrl(entry)) return null;

  const command = readOptionalCommand(record["command"]);
  const args = command === null ? [] : readArgs(record["args"]);
  const cwd = readCwd(record["cwd"], dir);
  const env = readEnv(record["env"]);
  const iconFile = readIconFile(record["icon"], dir);

  return { id, dir, name, entry, iconFile, command, args, cwd, env };
}

function toMiniApp(manifest: ParsedManifest): MiniApp {
  return {
    id: manifest.id,
    name: manifest.name,
    entry: manifest.entry,
    iconUrl: readIconDataUrl(manifest.iconFile),
    hasServer: manifest.command !== null,
  };
}

// ---------------------------------------------------------------------------
// metadata field readers
// ---------------------------------------------------------------------------

/** Read a string with a length cap; missing/wrong types degrade to `""`. */
function readString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function readOptionalCommand(value: unknown): string | null {
  const command = readString(value, MINI_APP_COMMAND_MAX).trim();
  return command.length > 0 ? command : null;
}

function readArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const args: string[] = [];
  let total = 0;
  for (const item of value.slice(0, MINI_APP_ARGS_MAX)) {
    if (typeof item !== "string") continue;
    const arg =
      item.length > MINI_APP_ARG_MAX ? item.slice(0, MINI_APP_ARG_MAX) : item;
    if (total + arg.length > MINI_APP_ARGS_TOTAL_MAX) break;
    total += arg.length;
    args.push(arg);
  }
  return args;
}

function readCwd(value: unknown, dir: string): string {
  const raw = readString(value, MINI_APP_ENTRY_MAX).trim();
  if (raw.length === 0) return dir;
  // Absolute paths are allowed only when they stay inside the app folder.
  const candidate = resolve(dir, raw);
  return isInside(dir, candidate) ? candidate : dir;
}

function readEnv(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const env: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, raw] of entries.slice(0, MINI_APP_ENV_MAX)) {
    if (
      key.length === 0 ||
      key.length > MINI_APP_ENV_KEY_MAX ||
      !MINI_APP_ENV_KEY_RE.test(key)
    ) {
      continue;
    }
    if (typeof raw !== "string" || raw.length > MINI_APP_ENV_VALUE_MAX)
      continue;
    env[key] = raw;
  }
  return env;
}

/** Resolve the optional icon to an absolute file path inside the app folder. */
function readIconFile(value: unknown, dir: string): string | null {
  const raw = readString(value, MINI_APP_ENTRY_MAX).trim();
  if (raw.length === 0) return null;
  const candidate = resolve(dir, raw);
  if (!isInside(dir, candidate)) return null;
  if (!existsSync(candidate)) return null;
  try {
    if (!statSync(candidate).isFile()) return null;
  } catch {
    return null;
  }
  const ext = extname(candidate).toLowerCase();
  if (!MINI_APP_ICON_EXTENSIONS.includes(ext)) return null;
  return candidate;
}

/** Read an icon file into a data URL; `null` when missing/too large. */
function readIconDataUrl(iconFile: string | null): string | null {
  if (iconFile === null) return null;
  try {
    const stat = statSync(iconFile);
    if (!stat.isFile() || stat.size > MINI_APP_ICON_MAX_BYTES) return null;
    const mime = MIME_BY_EXT[extname(iconFile).toLowerCase()];
    if (!mime) return null;
    const data = readFileSync(iconFile);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * True for `http(s)://` URLs whose host is this machine's loopback. Only
 * `localhost` and `127.0.0.1` are accepted: the renderer's CSP `frame-src`
 * cannot express the bracketed IPv6 wildcard-port form (`http://[::1]:*`), so
 * accepting `[::1]` here would produce an entry the iframe could never load.
 */
function isLoopbackHttpUrl(raw: string): boolean {
  if (raw.length === 0) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

/** Path containment check (path-separator agnostic). */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// ---------------------------------------------------------------------------
// index.json
// ---------------------------------------------------------------------------

function getIndexPath(): string {
  return join(getMiniAppsDir(), MINI_APP_INDEX_FILE);
}

function readIndexOrder(): string[] {
  const path = getIndexPath();
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  const order = (parsed as Record<string, unknown>)["order"];
  if (!Array.isArray(order)) return [];
  return order.filter(
    (id): id is string => typeof id === "string" && MINI_APP_ID_RE.test(id),
  );
}

/** Atomic write of `index.json` (temp file + rename). */
function writeIndexOrder(ids: string[]): void {
  const path = getIndexPath();
  const content = `${JSON.stringify({ order: ids }, null, 2)}\n`;
  mkdirSync(getMiniAppsDir(), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, { encoding: "utf8" });
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// supervised servers
// ---------------------------------------------------------------------------

function ensureServer(manifest: ParsedManifest): Promise<void> {
  const id = manifest.id;
  if (runningServers.has(id)) {
    return waitForServer(manifest.entry);
  }
  const pending = startingServers.get(id);
  if (pending) return pending;

  const promise = (async () => {
    // Reuse a server that is already listening (for example one the AI started
    // to debug the app) instead of spawning a duplicate that would fail to bind
    // the port. An external server is not tracked, so it is not stopped on quit.
    if (await probeServer(manifest.entry)) return;
    launchServer(manifest, 0);
    await waitForServer(manifest.entry);
  })().finally(() => {
    startingServers.delete(id);
  });
  startingServers.set(id, promise);
  return promise;
}

/** One short-timeout reachability probe; never throws. */
async function probeServer(entry: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      await fetch(entry, { signal: controller.signal });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function launchServer(manifest: ParsedManifest, restarts: number): void {
  const id = manifest.id;
  const env = mergeEnv(
    process.env as Record<string, string>,
    readUserEnv(),
    manifest.env,
  );
  let child: ChildProcess;
  try {
    child = spawn(manifest.command as string, manifest.args, {
      cwd: manifest.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // New process group on POSIX so quit can kill the whole tree.
      detached: process.platform !== "win32",
      shell: false,
    });
  } catch (err) {
    console.error(
      `[mini-apps] failed to start ${id}:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const server: RunningServer = { child, restarts, stopping: false };
  runningServers.set(id, server);

  child.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[mini-app:${id}] ${chunk.toString().trimEnd()}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[mini-app:${id}] ${chunk.toString().trimEnd()}`);
  });
  child.on("error", (err) => {
    console.error(`[mini-app:${id}] process error:`, err.message);
    // A spawn failure never emits `exit`; drop the entry so the next open can
    // retry instead of waiting on a process that never started.
    const current = runningServers.get(id);
    if (current && current.child === child) {
      current.stopping = true;
      runningServers.delete(id);
    }
  });
  child.on("exit", (code, signal) => {
    const current = runningServers.get(id);
    if (!current || current.child !== child) return;
    runningServers.delete(id);
    console.log(
      `[mini-app:${id}] server exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
    );
    if (quitting || current.stopping) return;
    if (current.restarts >= MINI_APP_SERVER_MAX_RESTARTS) {
      console.error(
        `[mini-app:${id}] giving up after ${current.restarts} restart(s).`,
      );
      return;
    }
    setTimeout(() => {
      if (!quitting && !runningServers.has(id)) {
        launchServer(manifest, current.restarts + 1);
      }
    }, 1000);
  });
}

/** Poll the entry URL until the server answers or the timeout elapses. */
async function waitForServer(entry: string): Promise<void> {
  const deadline = Date.now() + MINI_APP_SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        await fetch(entry, { signal: controller.signal });
        return;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Connection refused / aborted / DNS: the server is not ready yet. Keep
      // polling (a dev server can take a while to build and bind its port).
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, MINI_APP_SERVER_READY_INTERVAL_MS),
    );
  }
  throw new Error(
    `Mini app server did not respond within ${Math.round(
      MINI_APP_SERVER_READY_TIMEOUT_MS / 1000,
    )}s: ${entry}`,
  );
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      // Best-effort.
    }
    return;
  }
  try {
    // Negative pid targets the process group created by `detached`.
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Best-effort.
    }
  }
}
