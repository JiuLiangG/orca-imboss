import type {
  ProviderLoginEvent,
  ProviderModelsQuery,
  ProviderUpsert,
} from "@shared/types";
import { clipboard, ipcMain, shell, type WebContents } from "electron";
import { listAvailableModels, refreshModelStore } from "../agent/model-runtime";
import { loginProviderSubscription } from "../agent/provider-login";
import {
  listModels,
  listProviders,
  listProvidersPage,
  removeProvider,
  revealProviderKey,
  upsertProvider,
} from "../agent/providers";
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
    // Same for removal: keep the model store in sync after deleting a provider.
    await removeProvider(assertString(id, "provider id"));
    await refreshModelStore(new AbortController().signal);
  });

  ipcMain.handle("providers:listModels", (_event, input: unknown) =>
    listModels(input as ProviderModelsQuery),
  );

  // Full usable-model list from the shared ModelRuntime (built-in + custom,
  // auth-configured only) — backs the default-model / employee model selects.
  ipcMain.handle("models:list", () => listAvailableModels());

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

  ipcMain.handle("providers:copyKey", async (_event, id: unknown) => {
    const key = await revealProviderKey(assertString(id, "provider id"));
    if (!key) throw new Error("No API key set for this provider.");
    clipboard.writeText(key);
    return true;
  });
}

/** Pi already requires https. Re-check before handing the URL to the OS. */
function deliverLoginEvent(
  sender: WebContents,
  payload: ProviderLoginEvent,
): void {
  if (!sender.isDestroyed()) sender.send("providers:loginEvent", payload);
  if (!isHttpsUrl(payload.verificationUri)) return;
  void shell.openExternal(payload.verificationUri);
}

function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}
