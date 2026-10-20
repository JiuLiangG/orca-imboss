import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  isSubscriptionLoginProvider,
  XAI_UNREACHABLE,
} from "@shared/constants/providers";
import type { ProviderLoginEvent } from "@shared/types";
import { getModelRuntime } from "./model-runtime";
import { installGrokBuildXaiLogin } from "./xai-device-login";

type LoginInteraction = Parameters<ModelRuntime["login"]>[2];

/**
 * One pasted authorization code. Pi's Anthropic browser login races this
 * against the loopback callback and aborts it when the callback wins, so
 * the promise must stay pending instead of rejecting immediately.
 */
let pendingManual: ((value: string) => void) | null = null;

/** Deliver a code the user pasted into the subscription dialog. */
export function submitLoginCode(value: string): void {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Paste the authorization code first.");
  const deliver = pendingManual;
  if (!deliver) throw new Error("No sign-in is waiting for a code.");
  pendingManual = null;
  deliver(trimmed);
}

/**
 * Subscription sign-in for a built-in provider, driven by Pi's
 * `ModelRuntime.login`. The SDK writes the OAuth credential into
 * `auth.json` and refreshes its own auth snapshot.
 *
 * xAI is device code. The request itself is grok-build's contract (see
 * `xai-device-login.ts`): Pi's bundled login asks for fewer scopes and
 * attributes the grant to Pi. The callback receives the user code and
 * verification URL, then the call stays pending until the user approves
 * or `signal` aborts. Anthropic is Pi's Claude Pro/Max browser flow. On a
 * desktop the method prompt is answered with `browser`, because the
 * callback server runs in this process. The paste prompt stays open beside
 * it for the case where the browser cannot reach the loopback port.
 */
export async function loginProviderSubscription(
  providerId: string,
  notify: (event: ProviderLoginEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!isSubscriptionLoginProvider(providerId)) {
    throw new Error("Subscription sign-in is not available for this provider.");
  }
  const runtime = await getModelRuntime();
  if (providerId === "xai") installGrokBuildXaiLogin(runtime);
  const interaction: LoginInteraction = {
    signal,
    notify: (event) => {
      if (event.type === "device_code") {
        notify({
          type: "device_code",
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          ...(typeof event.expiresInSeconds === "number"
            ? { expiresInSeconds: event.expiresInSeconds }
            : {}),
        });
        return;
      }
      if (event.type === "auth_url") {
        notify({ type: "auth_url", verificationUri: event.url });
      }
    },
    prompt: (request) => answerLoginPrompt(request, notify),
  };
  try {
    await runtime.login(providerId, "oauth", interaction);
  } catch (error) {
    if (providerId !== "xai" || !isTransportFailure(error)) throw error;
    // The dialog shows a translated sentence. Keep the undici error here.
    console.error("[provider-login]", error);
    throw new Error(XAI_UNREACHABLE);
  } finally {
    pendingManual = null;
  }
}

function answerLoginPrompt(
  request: Parameters<LoginInteraction["prompt"]>[0],
  notify: (event: ProviderLoginEvent) => void,
): Promise<string> {
  if (request.type === "select") {
    // Pi asks browser vs copy-code. The desktop app uses the browser method;
    // its paste step still covers a callback the browser cannot deliver.
    const browser = request.options.find((option) => option.id === "browser");
    if (browser) return Promise.resolve(browser.id);
    return Promise.reject(new Error("This sign-in step is not supported."));
  }
  if (request.type !== "manual_code") {
    return Promise.reject(new Error("This sign-in step is not supported."));
  }
  notify({
    type: "manual_code",
    message: request.message,
    ...(request.placeholder ? { placeholder: request.placeholder } : {}),
  });
  return new Promise((resolve, reject) => {
    const signal = request.signal;
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    let settled = false;
    const attempt: { deliver: ((value: string) => void) | null } = {
      deliver: null,
    };
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (pendingManual === attempt.deliver) pendingManual = null;
      settle();
    };
    const onAbort = (): void => finish(() => reject(cancelledError()));
    attempt.deliver = (value: string): void => finish(() => resolve(value));
    pendingManual = attempt.deliver;
    signal?.addEventListener("abort", onAbort);
  });
}

function cancelledError(): Error {
  return new Error("Login cancelled");
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
