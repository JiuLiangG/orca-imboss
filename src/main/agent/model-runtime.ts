import type { ModelOption } from "../../shared/types";
import { getAuthPath, getModelsPath } from "../data-dir";
import { loadPiSdk, type PiSdk } from "./pi-sdk";

/** Pi ModelRuntime instance (the class itself has a private constructor). */
export type ModelRuntimeInstance = Awaited<
  ReturnType<PiSdk["ModelRuntime"]["create"]>
>;

let runtimePromise: Promise<ModelRuntimeInstance> | null = null;

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
export function getModelRuntime(): Promise<ModelRuntimeInstance> {
  if (!runtimePromise) {
    runtimePromise = (async (): Promise<ModelRuntimeInstance> => {
      const pi = await loadPiSdk();
      return pi.ModelRuntime.create({
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
 */
export async function listAvailableModels(): Promise<ModelOption[]> {
  const runtime = await getModelRuntime();
  return runtime
    .getAvailableSnapshot()
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
    }))
    .sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
    );
}
