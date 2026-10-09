import { integrationManager } from "./manager";

export { integrationManager } from "./manager";
export type {
  AdapterCallbacks,
  AdapterSession,
  InboundMedia,
  InboundMessage,
  IntegrationAdapter,
} from "./types";

/** Start enabled integrations (called once after database init). */
export async function initIntegrations(): Promise<void> {
  try {
    await integrationManager.init();
  } catch (err) {
    // A bad config must never block app startup.
    console.error(
      "[integrations] init failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Stop all adapters and flush config (called on `before-quit`). */
export async function shutdownIntegrations(): Promise<void> {
  try {
    await integrationManager.shutdown();
  } catch (err) {
    console.error(
      "[integrations] shutdown failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
