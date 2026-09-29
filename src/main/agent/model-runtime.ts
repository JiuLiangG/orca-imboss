import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SettingKeys } from "@shared/constants/settings";
import type { ModelOption } from "@shared/types";
import { getAuthPath, getModelsPath, getModelsStorePath } from "../data-dir";
import { getSetting } from "../db/settings";
import { loadPiSdk } from "./pi-sdk";

type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

let runtimePromise: Promise<ModelRuntime> | null = null;

/**
 * Lazily create (once) and cache the app's shared ModelRuntime — the "model
 * store" that holds the provider/model registry and availability snapshot for
 * the whole process.
 *
 * `getAuthPath`/`getModelsPath` point at the app's OWN `~/.imboss/agent`
 * files, never the host system's `~/.pi/agent`. The default create-time
 * availability refresh is kept: it populates `hasConfiguredAuth` from stored
 * credentials as soon as the instance exists (no network), so the agent can
 * resolve a configured model even before any network refresh lands.
 *
 * On creation failure the cached promise is reset so a later call retries
 * (defensive, per project guidelines).
 */
export function getModelRuntime(): Promise<ModelRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async (): Promise<ModelRuntime> => {
      const pi = await loadPiSdk();
      return await pi.ModelRuntime.create({
        authPath: getAuthPath(),
        modelsPath: getModelsPath(),
      });
    })();
    runtimePromise = runtimePromise.catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

/**
 * Cascade: employee's own model → app default → first available.
 * Shared by the agent session (`session.ts`) and the chat-title generator
 * (`title-gen.ts`) so both resolve the identical model.
 */
export function resolveModel(
  modelRuntime: ModelRuntime,
  employeeModelId: string | null | undefined,
): PiModel | undefined {
  const refs: Array<string | null | undefined> = [
    employeeModelId?.trim(),
    getSetting(SettingKeys.DefaultModel),
  ];
  for (const ref of refs) {
    const model = resolveModelRef(modelRuntime, ref);
    if (model) return model;
  }
  return modelRuntime.getAvailableSnapshot()[0];
}

/** Resolve a single `"provider/modelId"` reference against the runtime. */
function resolveModelRef(
  modelRuntime: ModelRuntime,
  ref: string | null | undefined,
): PiModel | undefined {
  if (!ref) return undefined;
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  const provider = ref.slice(0, slash);
  const modelId = ref.slice(slash + 1);
  const model = modelRuntime.getModel(provider, modelId);
  if (!model || !modelRuntime.hasConfiguredAuth(model.provider)) {
    return undefined;
  }
  return model;
}

/**
 * Refresh the app's model store over the network, forcing a fresh catalog
 * fetch (`allowNetwork: true, force: true`).
 *
 * Best-effort: a failed refresh is logged and never rejects, so callers must
 * not fail their own action (provider add/update/remove, app startup) just
 * because the store refresh failed.
 */
export async function refreshModelStore(signal?: AbortSignal): Promise<void> {
  try {
    const runtime = await getModelRuntime();
    await runtime.refresh({ allowNetwork: true, force: true, signal });
  } catch (error) {
    console.error("[model-runtime] refresh failed", error);
  }
}

/**
 * Every model the shared ModelRuntime can actually resolve (built-in dynamic
 * catalogs + custom providers, limited to providers with configured auth),
 * for the renderer's model selects. Pure in-memory snapshot — no network.
 *
 * The SDK runtime deliberately MERGES its bundled static catalog with the
 * persisted remote-catalog cache (`models-store.json`) by model id, so a
 * provider can surface bundled models that its own (newer) catalog no longer
 * contains. To keep the UI consistent with what the app has actually stored
 * (`models-store.json` + `models.json`), a stored catalog wins when the
 * runtime applied it, with the bundled catalog as the offline fallback.
 */
export async function listAvailableModels(): Promise<ModelOption[]> {
  const runtime = await getModelRuntime();
  const available = runtime.getAvailableSnapshot();
  const storedIds = await readStoredModelIds();

  // A stored catalog is authoritative only when the runtime actually applied
  // it (every stored id resolves), i.e. it is not a stale cache the SDK chose
  // to ignore in favour of its bundled catalog. Providers without an entry
  // (custom providers, never-refreshed built-ins) keep the runtime models.
  const authoritative = new Map<string, ReadonlySet<string>>();
  for (const [provider, ids] of storedIds) {
    const runtimeIds = new Set(runtime.getModels(provider).map((m) => m.id));
    let applied = true;
    for (const id of ids) {
      if (!runtimeIds.has(id)) {
        applied = false;
        break;
      }
    }
    if (applied) authoritative.set(provider, ids);
  }

  const seen = new Set<string>();
  const models: ModelOption[] = [];
  for (const model of available) {
    const ids = authoritative.get(model.provider);
    if (ids && !ids.has(model.id)) continue;
    const key = `${model.provider}/${model.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    models.push({ provider: model.provider, id: model.id, name: model.name });
  }

  return models.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
  );
}

/**
 * Model ids stored per provider in the SDK's `models-store.json` cache,
 * defensively parsed. A missing or corrupt file yields an empty map so the
 * list falls back to the runtime catalog (per project guidelines, a bad cache
 * must never break the UI).
 */
async function readStoredModelIds(): Promise<Map<string, Set<string>>> {
  const { readFile } = await import("fs/promises");
  let raw: string;
  try {
    raw = await readFile(getModelsStorePath(), "utf8");
  } catch {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return new Map();
  }
  const result = new Map<string, Set<string>>();
  for (const [provider, entry] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    const models = (entry as { models?: unknown } | null)?.models;
    if (!Array.isArray(models)) continue;
    const ids = new Set<string>();
    for (const model of models) {
      const id = (model as { id?: unknown } | null)?.id;
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
    if (ids.size > 0) result.set(provider, ids);
  }
  return result;
}
