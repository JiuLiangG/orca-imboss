import { INTEGRATION_PLATFORMS } from "@shared/constants/integrations";
import type {
  IntegrationConfigPatch,
  IntegrationPlatform,
} from "@shared/types";
import { ipcMain } from "electron";
import { integrationManager } from "../integrations";
import { assertObject, assertString } from "./helpers";

/**
 * Renderer ↔ main IPC for the Settings → Integrations page. Secrets are never
 * returned: `getState` masks them, and `setConfig` only accepts a patch.
 */
export function registerIntegrationHandlers(): void {
  ipcMain.handle("integrations:getState", () => integrationManager.getState());

  ipcMain.handle(
    "integrations:setConfig",
    async (_event, platform: unknown, patch: unknown) => {
      const safePlatform = assertPlatform(platform);
      const safePatch = assertObject(patch, "patch") as IntegrationConfigPatch;
      await integrationManager.setConfig(safePlatform, safePatch);
      return integrationManager.getState();
    },
  );

  ipcMain.handle(
    "integrations:setEnabled",
    async (_event, platform: unknown, enabled: unknown) => {
      const safePlatform = assertPlatform(platform);
      if (typeof enabled !== "boolean") {
        throw new Error("enabled must be a boolean.");
      }
      await integrationManager.setEnabled(safePlatform, enabled);
      return integrationManager.getState();
    },
  );

  ipcMain.handle("integrations:login", async (_event, platform: unknown) => {
    await integrationManager.login(assertPlatform(platform));
    return integrationManager.getState();
  });

  ipcMain.handle("integrations:logout", async (_event, platform: unknown) => {
    await integrationManager.logout(assertPlatform(platform));
    return integrationManager.getState();
  });

  ipcMain.handle(
    "integrations:clearContacts",
    async (_event, platform: unknown) => {
      await integrationManager.clearContacts(assertPlatform(platform));
      return integrationManager.getState();
    },
  );
}

function assertPlatform(value: unknown): IntegrationPlatform {
  const platform = assertString(value, "platform");
  if (!(INTEGRATION_PLATFORMS as string[]).includes(platform)) {
    throw new Error("Unknown integration platform.");
  }
  return platform as IntegrationPlatform;
}
