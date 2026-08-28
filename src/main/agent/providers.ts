import type {
  ProviderApiType,
  ProviderInfo,
  ProviderUpsert,
} from "../../shared/types";
import { CURATED_PROVIDERS, PROVIDER_API_TYPES } from "../../shared/types";
import { getAuthPath, getModelsPath } from "../data-dir";

/**
 * Exclusive owner of the Pi environment's `auth.json` and `models.json` —
 * the source of truth for provider configuration (confirmed decision).
 *
 * All writes are atomic (temp file + rename) and credentials live only in
 * `auth.json` (chmod 0600). Renderer-facing reads return masked data.
 */

interface AuthFile {
  [providerId: string]:
    { type: "api_key"; key: string } | { type: string; [k: string]: unknown };
}

interface ModelSpec {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}

interface ProviderSpec {
  baseUrl?: string;
  api?: ProviderApiType;
  models?: ModelSpec[];
}

interface ModelsFile {
  providers?: Record<string, ProviderSpec>;
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

const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;

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
    if (typeof mid !== "string" || !SAFE_ID_RE.test(mid) || mid.length > 128) {
      throw new Error(`Invalid model id: ${String(mid).slice(0, 32)}`);
    }
  }
  return [...new Set(modelIds)];
}

function validateApiKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (typeof key !== "string" || key.trim().length < 8 || key.length > 4096) {
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

// --- public API ----------------------------------------------------------------

export async function listProviders(): Promise<ProviderInfo[]> {
  const [auth, models] = await Promise.all([
    readJson<AuthFile>(getAuthPath()),
    readJson<ModelsFile>(getModelsPath()),
  ]);
  const custom = models.providers ?? {};

  const infos: ProviderInfo[] = [];

  for (const id of CURATED_PROVIDERS) {
    const credential = auth[id];
    const key =
      credential && typeof credential.key === "string"
        ? credential.key
        : undefined;
    infos.push({
      id,
      kind: "built-in",
      label: id,
      hasKey: Boolean(key),
      keyHint: maskKey(key),
      modelIds: [],
    });
  }

  for (const [id, spec] of Object.entries(custom)) {
    if (!SAFE_ID_RE.test(id)) continue; // skip anything unreadable
    const credential = auth[id];
    const key =
      credential && typeof credential.key === "string"
        ? credential.key
        : undefined;
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
      hasKey: Boolean(key),
      keyHint: maskKey(key),
    });
  }

  return infos;
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
