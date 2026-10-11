import { SettingKeys } from "@shared/constants/settings";
import { Agent, EnvHttpProxyAgent, install, setGlobalDispatcher } from "undici";
import { getSetting } from "./db/settings";

/**
 * Process-wide outbound HTTP proxy for the main process.
 *
 * Foreign model providers are typically only reachable through a proxy, so the
 * user configures one URL in Settings → Network. Because the embedded Pi SDK
 * exposes no per-request `fetch` hook, the only provider-agnostic mechanism is
 * a global undici dispatcher: `pi-ai` adapters (and the app's own `fetch`
 * calls) default to `globalThis.fetch`, which undici's `install()` aligns with
 * its dispatcher (the SDK does the same in its own entrypoints).
 *
 * Localhost is always bypassed so the app's Mini App health checks and local
 * model servers (Ollama / LM Studio / vLLM) keep working behind a proxy.
 */

const LOCALHOST_BYPASS = "localhost,127.0.0.1,::1";

/** Upper/lowercase spellings honored by provider SDKs and shell tools. */
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
] as const;

type ProxyEnvKey = (typeof PROXY_ENV_KEYS)[number];

let globalsInstalled = false;
let envCaptured = false;
const originalEnv: Partial<Record<ProxyEnvKey, string | undefined>> = {};

/**
 * Validate and normalize a user-entered proxy URL. Returns `null` for an empty
 * value (meaning "connect directly") and throws for anything that is not a
 * usable HTTP(S) proxy — mirroring the Pi SDK, SOCKS and PAC are rejected.
 */
export function normalizeProxyUrl(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Proxy URL must be a valid http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      "Unsupported proxy protocol. SOCKS and PAC proxy URLs are not supported; use an HTTP or HTTPS proxy URL.",
    );
  }
  return trimmed;
}

/**
 * Apply a proxy URL to the whole main process. An empty/null value removes the
 * app-level proxy and falls back to the environment (or a direct connection).
 * Throws when the URL is invalid; callers that must not fail (e.g. startup with
 * a stale stored value) should catch.
 *
 * Applying is idempotent and takes effect for subsequent requests without a
 * restart: undici's `fetch` resolves the global dispatcher at request time.
 */
export function applyHttpProxy(raw: string | null | undefined): string | null {
  const url = normalizeProxyUrl(raw);
  ensureUndiciGlobals();

  if (url) {
    setGlobalDispatcher(
      new EnvHttpProxyAgent({
        ...proxyAgentOptions(),
        httpProxy: url,
        httpsProxy: url,
      }),
    );
    writeProxyEnv(url);
  } else {
    // No app-level proxy: restore the environment and fall back to whatever
    // proxy the environment itself provides (if any), otherwise direct.
    restoreProxyEnv();
    setGlobalDispatcher(dispatcherFromEnvironment());
  }
  return url;
}

/**
 * Shared dispatcher tuning for env/proxy agents. Mirrors the Pi SDK's proxy
 * agent: no HTTP/2 through the proxy, tunnel plain-HTTP origins too, and a
 * longer happy-eyeballs attempt timeout for high-latency routes.
 */
function proxyAgentOptions() {
  return {
    noProxy: LOCALHOST_BYPASS,
    allowH2: false,
    proxyTunnel: true,
    connect: { autoSelectFamilyAttemptTimeout: 2_000 },
  };
}

/** Env-configured dispatcher; a malformed proxy env degrades to a direct Agent. */
function dispatcherFromEnvironment(): Agent | EnvHttpProxyAgent {
  try {
    return new EnvHttpProxyAgent(proxyAgentOptions());
  } catch (error) {
    console.error(
      "[http-proxy] invalid proxy environment; using a direct connection",
      error instanceof Error ? error.message : error,
    );
    return new Agent();
  }
}

/**
 * Read the persisted proxy setting and apply it. Best-effort: a corrupt or
 * stale stored value is logged and ignored so startup never hard-fails.
 */
export function applyStoredHttpProxy(): void {
  try {
    applyHttpProxy(getSetting(SettingKeys.HttpProxy));
  } catch (error) {
    console.error(
      "[http-proxy] failed to apply stored proxy setting",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Swap Node's built-in fetch for undici's so it honors the global dispatcher. */
function ensureUndiciGlobals(): void {
  if (globalsInstalled) return;
  install();
  globalsInstalled = true;
}

/** Snapshot the process environment once, before we ever overwrite it. */
function captureProxyEnv(): void {
  if (envCaptured) return;
  envCaptured = true;
  for (const key of PROXY_ENV_KEYS) {
    originalEnv[key] = process.env[key];
  }
}

/** Expose the proxy to the process env so SDK adapters and subprocesses see it. */
function writeProxyEnv(url: string): void {
  captureProxyEnv();
  for (const key of PROXY_ENV_KEYS) {
    process.env[key] = url;
  }
}

/** Restore whatever the environment held before the app applied a proxy. */
function restoreProxyEnv(): void {
  captureProxyEnv();
  for (const key of PROXY_ENV_KEYS) {
    const original = originalEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}
