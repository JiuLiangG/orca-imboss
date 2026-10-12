import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  isSubscriptionLoginProvider,
  XAI_UNREACHABLE,
} from "@shared/constants/providers";
import type { ProviderLoginEvent } from "@shared/types";
import { getModelRuntime } from "./model-runtime";

type LoginInteraction = Parameters<ModelRuntime["login"]>[2];

/**
 * Subscription sign-in for a built-in provider, driven by Pi's
 * `ModelRuntime.login`. The SDK writes the OAuth credential into
 * `auth.json` and refreshes its own auth snapshot. xAI's flow is device
 * code: the callback receives the user code and verification URL, then the
 * call stays pending until the user approves or `signal` aborts.
 */
export async function loginProviderSubscription(
  providerId: string,
  notify: (event: ProviderLoginEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!isSubscriptionLoginProvider(providerId)) {
    throw new Error("Subscription sign-in is only available for xAI.");
  }
  const runtime = await getModelRuntime();
  const interaction: LoginInteraction = {
    signal,
    notify: (event) => {
      if (event.type !== "device_code") return;
      notify({
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(typeof event.expiresInSeconds === "number"
          ? { expiresInSeconds: event.expiresInSeconds }
          : {}),
      });
    },
    prompt: () =>
      Promise.reject(new Error("This sign-in step is not supported.")),
  };
  try {
    await runtime.login(providerId, "oauth", interaction);
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    // The dialog shows a translated sentence. Keep the undici error here.
    console.error("[provider-login]", error);
    throw new Error(XAI_UNREACHABLE);
  }
}

const TRANSPORT_FAILURE =
  /Connect Timeout|UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ENETUNREACH/;

/** True when the device-code request never reached auth.x.ai. */
function isTransportFailure(error: unknown): boolean {
  const links = errorChain(error);
  if (links.some((link) => link.message === "Login cancelled")) return false;
  return links.some(
    (link) =>
      (link.code !== undefined && TRANSPORT_FAILURE.test(link.code)) ||
      TRANSPORT_FAILURE.test(link.message),
  );
}

function errorChain(error: unknown): Array<{ message: string; code?: string }> {
  const links: Array<{ message: string; code?: string }> = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (!(current instanceof Error)) break;
    const code =
      "code" in current && typeof current.code === "string"
        ? current.code
        : undefined;
    links.push({ message: current.message, code });
    current = current.cause;
  }
  return links;
}
