import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@shared/constants/paged";
import {
  CURATED_PROVIDERS,
  PROVIDER_API_TYPES,
} from "@shared/constants/providers";
import type {
  AuthFile,
  ModelsFile,
  ModelSpec,
  PageQuery,
  PageResult,
  ProviderApiType,
  ProviderInfo,
  ProviderModelsQuery,
  ProviderUpsert,
} from "@shared/types";
import { getAuthPath, getModelsPath } from "../data-dir";

/**
 * Exclusive owner of the Pi environment's `auth.json` and `models.json` —
 * the source of truth for provider configuration (confirmed decision).
 *
 * All writes are atomic (temp file + rename) and credentials live only in
 * `auth.json` (chmod 0600). Renderer-facing reads return masked data.
 */

const MODELS_FETCH_TIMEOUT_MS = 10_000;

/** Provider ids remain strict: they are object keys, not display data. */
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Model ids are opaque data (never file paths or shell arguments), and relay /
 * aggregator providers use wider ids — OpenRouter's `anthropic/claude-opus-4.5`,
 * Bedrock's `amazon.nova-2-lite-v1:0`, Cloudflare's `@cf/...`, `~`/`+` variants.
 * The allow-list covers every character seen in the SDK's bundled catalogs.
 */
const MODEL_ID_RE = /^[A-Za-z0-9._:/@~+-]+$/;

export async function listProviders(): Promise<ProviderInfo[]> {
  const [auth, models] = await Promise.all([
    readJson<AuthFile>(getAuthPath()),
    readJson<ModelsFile>(getModelsPath()),
  ]);
  const custom = models.providers ?? {};

  const infos: ProviderInfo[] = [];

  // Built-in (curated) providers appear only once configured (a key is set);
  // unconfigured built-ins are not shown ("no prefilled providers").
  for (const id of CURATED_PROVIDERS) {
    const stored = readStoredCredential(auth[id]);
    if (!stored) continue; // skip unconfigured built-ins
    infos.push({
      id,
      kind: "built-in",
      label: id,
      hasKey: true,
      authType: stored.authType,
      keyHint: stored.authType === "api_key" ? maskKey(stored.key) : null,
      modelIds: [],
    });
  }

  for (const [id, spec] of Object.entries(custom)) {
    if (!SAFE_ID_RE.test(id)) continue; // skip anything unreadable
    const stored = readStoredCredential(auth[id]);
    infos.push({
      id,
      kind: "custom",
      label: id,
      baseUrl: spec.baseUrl,
      apiType:
        spec.api && PROVIDER_API_TYPES.includes(spec.api)
          ? spec.api
          : undefined,
      modelIds: (spec.models ?? []).map((m) => m.id),
      hasKey: stored !== null,
      authType: stored?.authType ?? null,
      keyHint: stored?.authType === "api_key" ? maskKey(stored.key) : null,
    });
  }

  return infos;
}

/**
 * One page of providers, ordered `id ASC` (the full list is curated-first;
 * the paged path uses the plain `id` order for a stable string keyset).
 * Optional `LIKE`-style filter on `id OR label` (the models module has no
 * search box today, but the endpoint stays symmetric with the others).
 * Source is `auth.json`/`models.json` (not SQLite), so the page is derived
 * from the in-memory array. Cursor = the last row's `id` (provider ids are
 * `[A-Za-z0-9._-]+`, so raw embedding is safe).
 */
export async function listProvidersPage(
  page: PageQuery = {},
): Promise<PageResult<ProviderInfo>> {
  const limit = Math.min(
    Math.max(Math.trunc(page.limit ?? DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const needle = (page.query ?? "").trim().toLowerCase();
  const all = (await listProviders()).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  let start = 0;
  if (page.cursor) {
    const cursor = page.cursor;
    start = all.findIndex((provider) => provider.id.localeCompare(cursor) > 0);
    if (start < 0) start = all.length;
  }

  const selected =
    needle.length === 0
      ? all.slice(start)
      : all
          .slice(start)
          .filter(
            (provider) =>
              provider.id.toLowerCase().includes(needle) ||
              provider.label.toLowerCase().includes(needle),
          );

  const hasMore = selected.length > limit;
  const items = selected.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? last.id : null,
    hasMore,
  };
}

/**
 * Add or update a provider:
 * - built-in → only the API key is stored (`auth.json[<id>]`).
 * - custom   → provider block written to `models.json`, key to `auth.json`.
 * Omitting `apiKey` keeps any existing key (update flows).
 */
export async function upsertProvider(input: ProviderUpsert): Promise<void> {
  const id = validateProviderId(input.id);
  const apiKey = validateApiKey(input.apiKey);

  const auth = (await readJson<AuthFile>(getAuthPath())) as AuthFile;
  const models = (await readJson<ModelsFile>(getModelsPath())) as ModelsFile;
  if (!models.providers) models.providers = {};

  if (input.kind === "built-in") {
    if (!CURATED_PROVIDERS.includes(id as (typeof CURATED_PROVIDERS)[number])) {
      throw new Error("Unknown built-in provider.");
    }
    if (apiKey !== undefined) {
      auth[id] = { type: "api_key", key: apiKey };
    }
    delete models.providers[id]; // keep curated list authoritative
  } else {
    if (apiKey === undefined && !auth[id]) {
      throw new Error("An API key is required for new providers.");
    }
    if (apiKey !== undefined) {
      auth[id] = { type: "api_key", key: apiKey };
    }
    const requestedApi = input.apiType ?? "openai-completions";
    const apiType = (PROVIDER_API_TYPES as readonly string[]).includes(
      requestedApi,
    )
      ? requestedApi
      : "openai-completions";
    models.providers[id] = {
      baseUrl: validateBaseUrl(input.baseUrl),
      api: apiType,
      models: toModelSpecs(validateModelIds(input.modelIds)),
    };
  }

  await writeJson(getAuthPath(), auth);
  await writeJson(getModelsPath(), models);
}

/**
 * Fetch the model list for a custom provider from its base URL + api type.
 * Used by the add-provider flow's "Fetch models" button. The API key is only
 * used for this request and is never persisted here.
 */
export async function listModels(
  input: ProviderModelsQuery,
): Promise<string[]> {
  const baseUrl = validateBaseUrl(input.baseUrl);
  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey) throw new Error("An API key is required.");
  if (!PROVIDER_API_TYPES.includes(input.apiType)) {
    throw new Error("Unsupported API type.");
  }
  const apiType = input.apiType;

  let url = modelsEndpoint(baseUrl, apiType);
  const headers: Record<string, string> = {};
  if (apiType === "google-generative-ai") {
    const parsed = new URL(url);
    parsed.searchParams.set("key", apiKey);
    url = parsed.toString();
  } else if (apiType === "anthropic-messages") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "AbortError"
        ? "Timed out fetching models."
        : "Could not reach the provider to fetch models.",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Models request failed (HTTP ${res.status}).`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("Provider returned a non-JSON response.");
  }
  return [...new Set(parseModelIds(apiType, data))];
}

/** Remove credentials for a provider, plus its models.json entry when custom. */
export async function removeProvider(id: string): Promise<void> {
  validateProviderId(id);
  const auth = (await readJson<AuthFile>(getAuthPath())) as AuthFile;
  const models = (await readJson<ModelsFile>(getModelsPath())) as ModelsFile;

  const existedAuth = delete auth[id];
  const existedModels = models.providers ? delete models.providers[id] : false;

  if (existedAuth || existedModels) {
    await writeJson(getAuthPath(), auth);
    await writeJson(getModelsPath(), models);
  }
}

/**
 * Return a provider's full API key for the explicit “显示” reveal action in
 * the UI. The key never leaves the main process unless the user asks for it;
 * all list/detail reads use the masked `keyHint` instead.
 */
export async function revealProviderKey(id: string): Promise<string | null> {
  validateProviderId(id);
  const auth = (await readJson<AuthFile>(getAuthPath())) as AuthFile;
  const credential = auth[id];
  return credential && typeof credential.key === "string"
    ? credential.key
    : null;
}

// --- safe JSON file plumbing -------------------------------------------------

async function readJson<T>(filePath: string): Promise<Partial<T>> {
  const { readFile, stat } = await import("fs/promises");
  try {
    await stat(filePath);
  } catch {
    return {};
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Partial<T>;
  } catch {
    // A corrupt config file must not brick the app; treat as empty and let
    // the next write recreate it. (Defensive, per project guidelines.)
    return {};
  }
}

/**
 * A credential the provider list can describe without revealing secrets.
 * OAuth entries (`type: "oauth"`, `access`/`refresh`) count as configured
 * even though they have no API key. Anything else with a `key` is an API key.
 */
function readStoredCredential(
  credential: AuthFile[string] | undefined,
): { authType: "api_key"; key: string } | { authType: "oauth" } | null {
  if (!credential || typeof credential !== "object") return null;
  if (
    credential.type === "oauth" &&
    typeof credential["access"] === "string" &&
    credential["access"].length > 0
  ) {
    return { authType: "oauth" };
  }
  if (typeof credential.key === "string" && credential.key.length > 0) {
    return { authType: "api_key", key: credential.key };
  }
  return null;
}

/** Write atomically and restrict perms on POSIX (both files may embed keys). */
async function writeJson(filePath: string, value: unknown): Promise<void> {
  const { writeFile, rename, chmod } = await import("fs/promises");
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, filePath);
  if (process.platform !== "win32") {
    try {
      await chmod(filePath, 0o600);
    } catch {
      // Best-effort hardening only.
    }
  }
}

// --- validation helpers ------------------------------------------------------

function validateProviderId(id: unknown): string {
  if (
    typeof id !== "string" ||
    !SAFE_ID_RE.test(id) ||
    id.length === 0 ||
    id.length > 64
  ) {
    throw new Error('Invalid provider id. Use letters, digits, ".", "_", "-".');
  }
  return id;
}

function validateModelIds(modelIds: string[] | undefined): string[] {
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    throw new Error("At least one model id is required.");
  }
  if (modelIds.length > 256) throw new Error("Too many model ids.");
  for (const mid of modelIds) {
    if (typeof mid !== "string" || !MODEL_ID_RE.test(mid) || mid.length > 128) {
      throw new Error(`Invalid model id: ${String(mid).slice(0, 32)}`);
    }
  }
  return [...new Set(modelIds)];
}

function validateApiKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (typeof key !== "string" || key.length > 4096) {
    throw new Error("API key looks invalid.");
  }
  return key.trim();
}

function validateBaseUrl(url: string | undefined): string {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    throw new Error("A base URL is required.");
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("bad protocol");
    }
    return url;
  } catch {
    throw new Error("Base URL must be a valid http(s) URL.");
  }
}

function toModelSpecs(ids: string[]): ModelSpec[] {
  // Sensible generic defaults; cost/context numbers can be refined later once
  // per-model metadata handling lands with runtime integration.
  return ids.map((id) => ({
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
  }));
}

function maskKey(key: string | undefined): string | null {
  if (!key || key.length < 4) return null;
  return `…${key.slice(-4)}`;
}

/** Model-list endpoint for a custom provider, derived from its base URL + api type. */
function modelsEndpoint(baseUrl: string, apiType: ProviderApiType): string {
  const base = baseUrl.replace(/\/+$/, "");
  switch (apiType) {
    case "google-generative-ai":
      return `${base}/models`;
    case "anthropic-messages": {
      const v1 = base.endsWith("/v1") ? base : `${base}/v1`;
      return `${v1}/models`;
    }
    default:
      // OpenAI-compatible: assume the base already includes the API root (e.g. /v1).
      return `${base}/models`;
  }
}

/** Map a models response payload to a list of model ids, per api type. */
function parseModelIds(apiType: ProviderApiType, data: unknown): string[] {
  const obj = data as Record<string, unknown>;
  if (apiType === "google-generative-ai") {
    const models = (obj.models ?? []) as Array<{ name?: string }>;
    return models
      .map((m) =>
        typeof m.name === "string" ? m.name.replace(/^models\//, "") : "",
      )
      .filter(Boolean);
  }
  const dataList = (obj.data ?? []) as Array<{ id?: string }>;
  return dataList
    .map((m) => (typeof m.id === "string" ? m.id : ""))
    .filter(Boolean);
}
