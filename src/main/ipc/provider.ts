import { SettingKeys } from "@shared/constants/settings";
import type {
  ProviderLoginEvent,
  ProviderModelsQuery,
  ProviderUpsert,
} from "@shared/types";
import { clipboard, ipcMain, shell, type WebContents } from "electron";
import { listAvailableModels, refreshModelStore } from "../agent/model-runtime";
import { reconcileCapabilityRefs } from "../capability-refs";
import {
  notifyEmployeesChanged,
  reconcileEmployeeRefsOnRead,
} from "../employee-events";
import {
  loginProviderSubscription,
  submitLoginCode,
} from "../agent/provider-login";
import {
  listModels,
  listProviders,
  listProvidersPage,
  removeProvider,
  revealProviderKey,
  upsertProvider,
} from "../agent/providers";
import { setSetting } from "../db/settings";
import { getImageModelRef } from "../image-gen";
import { assertString, parsePageQuery } from "./helpers";

/** One in-flight subscription sign-in. A second click is rejected. */
let activeLogin: {
  controller: AbortController;
  sender: WebContents;
} | null = null;

// --- providers / skills ---
export function registerProviderHandlers(): void {
  ipcMain.handle("providers:list", () => listProviders());

  ipcMain.handle("providers:listPage", (_event, page: unknown) =>
    listProvidersPage(parsePageQuery(page)),
  );

  ipcMain.handle("providers:upsert", async (_event, input: ProviderUpsert) => {
    // Persist the provider first, then refresh the app's model store so the
    // newly added/updated provider is immediately available. Best-effort:
    // a refresh failure is logged and never fails the save.
    await upsertProvider(input);
    await refreshModelStore(new AbortController().signal);
  });

  ipcMain.handle("providers:remove", async (_event, id: unknown) => {
    // Removal cascades into every stored reference to that provider: the
    // app-wide image model (cleared here, its own single trigger) and — via the
    // shared capability-reference sweep — employee `model_id`s plus the default
    // model, which would otherwise be refs that can never resolve again.
    const providerId = assertString(id, "provider id");
    await removeProvider(providerId);
    clearImageModelIfProviderRemoved(providerId);
    await refreshModelStore(new AbortController().signal);
    const report = reconcileCapabilityRefs({ force: true });
    notifyEmployeesChanged(report.employeeIds);
  });

  ipcMain.handle("providers:listModels", (_event, input: unknown) =>
    listModels(input as ProviderModelsQuery),
  );

  // Full usable-model list from the shared ModelRuntime (built-in + custom,
  // auth-configured only) — backs the default-model / employee model selects.
  ipcMain.handle("models:list", () => {
    // Read-path self-heal for model references (employee `model_id` + the
    // app-wide default model) and, in the same pass, for capability refs: a
    // provider or server removed outside the app is repaired the next time the
    // UI reads a list. Throttled and never throws.
    reconcileEmployeeRefsOnRead();
    return listAvailableModels();
  });

  ipcMain.handle("providers:login", async (event, id: unknown) => {
    if (activeLogin) {
      throw new Error("A sign-in is already in progress.");
    }
    const providerId = assertString(id, "provider id");
    const controller = new AbortController();
    const sender = event.sender;
    activeLogin = { controller, sender };
    const onGone = (): void => controller.abort();
    sender.once("destroyed", onGone);
    try {
      await loginProviderSubscription(
        providerId,
        (payload) => deliverLoginEvent(sender, payload),
        controller.signal,
      );
      await refreshModelStore(controller.signal);
    } finally {
      sender.removeListener("destroyed", onGone);
      if (activeLogin?.controller === controller) activeLogin = null;
    }
  });

  ipcMain.handle("providers:cancelLogin", () => {
    activeLogin?.controller.abort();
  });

  ipcMain.handle("providers:submitLogin", (_event, value: unknown) => {
    submitLoginCode(assertString(value, "authorization code"));
  });

  ipcMain.handle("providers:copyKey", async (_event, id: unknown) => {
    const key = await revealProviderKey(assertString(id, "provider id"));
    if (!key) throw new Error("No API key set for this provider.");
    clipboard.writeText(key);
    return true;
  });
}

/**
 * The image-generation model is one app-wide setting stored as
 * `"<provider>/<modelId>"`. Once its provider is deleted that ref can never
 * resolve, so the setting is cleared at this single point where the removal has
 * actually succeeded — otherwise the dangling value would keep breaking
 * `imb_generate_image` with a confusing "not configured" failure. Only a ref
 * whose `<provider>` equals the removed id is cleared; removing any other
 * provider leaves the setting untouched.
 */
function clearImageModelIfProviderRemoved(providerId: string): void {
  const ref = getImageModelRef();
  if (ref !== null && ref.provider === providerId) {
    setSetting(SettingKeys.ImageModel, "");
  }
}

/** Pi already requires https. Re-check before handing the URL to the OS. */
function deliverLoginEvent(
  sender: WebContents,
  payload: ProviderLoginEvent,
): void {
  if (!sender.isDestroyed()) sender.send("providers:loginEvent", payload);
  const url = loginUrl(payload);
  if (!url || !isHttpsUrl(url)) return;
  void shell.openExternal(url);
}

function loginUrl(payload: ProviderLoginEvent): string | undefined {
  if (payload.type === "device_code" || payload.type === "auth_url") {
    return payload.verificationUri;
  }
  return undefined;
}

function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}
