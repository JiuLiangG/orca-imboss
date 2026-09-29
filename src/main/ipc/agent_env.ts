import { t } from "@shared/l10n";
import type { ProviderModelsQuery, ProviderUpsert } from "@shared/types";
import { clipboard, ipcMain } from "electron";
import { listAvailableModels, refreshModelStore } from "../agent/model-runtime";
import {
  listModels,
  listProviders,
  listProvidersPage,
  removeProvider,
  revealProviderKey,
  upsertProvider,
} from "../agent/providers";
import {
  installSkillsFromFolders,
  listSkills,
  listSkillsPage,
  uninstallSkill,
} from "../agent/skills";
import { showOpenDialog } from "./dialog";
import { assertString, parsePageQuery } from "./helpers";

async function pickSkillFolders(): Promise<string[] | null> {
  return showOpenDialog({
    title: t("Select skill folders"),
    properties: ["openDirectory", "multiSelections"],
  });
}

// --- providers / skills ---
export function registerAgentEnvHandlers(): void {
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

  ipcMain.handle("providers:copyKey", async (_event, id: unknown) => {
    const key = await revealProviderKey(assertString(id, "provider id"));
    if (!key) throw new Error("No API key set for this provider.");
    clipboard.writeText(key);
    return true;
  });

  ipcMain.handle("skills:list", () => listSkills());

  ipcMain.handle("skills:listPage", (_event, page: unknown) =>
    listSkillsPage(parsePageQuery(page)),
  );

  ipcMain.handle("skills:install", async () => {
    const paths = await pickSkillFolders();
    if (paths === null) return null;
    const imported = await installSkillsFromFolders(paths);
    return imported;
  });

  ipcMain.handle("skills:uninstall", async (_event, name: unknown) => {
    await uninstallSkill(assertString(name, "skill name"));
  });
}
