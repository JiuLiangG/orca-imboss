import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Device-code sign-in whose token contract matches grok-build, not Pi.
 *
 * Pi's bundled xAI login (`@earendil-works/pi-ai` `auth/oauth/xai.js`) posts
 * `referrer=pi` and six scopes. grok-build posts `referrer=grok-build` and
 * the ten scopes frozen in `xai-grok-login` `default_oauth2_scopes`. The
 * issuer and client id are the same. Pi does not expose those two fields,
 * so this replaces only `oauth.login`. Refresh and `toAuth` stay Pi's:
 * a refresh token keeps the scopes it was granted, and the access token is
 * still sent as a bearer.
 *
 * The replacement has to land on the provider object `ModelRuntime.login`
 * will read. With no `models.json` entry for xAI, that object is the
 * built-in provider, and a later recompose returns the same object.
 */

const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const XAI_REFERRER = "grok-build";
/** grok-build's `ClientSurface::Ui` (`strum` snake_case). imboss shows the code in the app. */
const XAI_CLIENT_SURFACE = "ui";

/** Order matches grok-build's frozen `default_oauth2_scopes` test. */
const XAI_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "grok-cli:access",
  "api:access",
  "conversations:read",
  "conversations:write",
  "workspaces:read",
  "workspaces:write",
] as const;

const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const MIN_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INCREMENT_MS = 5000;
const CANCELLED = "Login cancelled";

type LoginInteraction = Parameters<ModelRuntime["login"]>[2];

interface OAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

type JsonObject = Record<string, unknown>;

interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds: number;
}

/** Point xAI's OAuth login at the grok-build device-code contract. */
export function installGrokBuildXaiLogin(runtime: ModelRuntime): void {
  const oauth = runtime.getProvider("xai")?.auth.oauth;
  if (!oauth) {
    throw new Error("xAI subscription sign-in is unavailable.");
  }
  oauth.login = (interaction) =>
    loginXaiWithGrokBuildContract(interaction as LoginInteraction);
}

async function loginXaiWithGrokBuildContract(
  interaction: LoginInteraction,
): Promise<OAuthCredential> {
  const signal = interaction.signal;
  if (!signal) {
    throw new Error("Sign-in was started without a cancellation signal.");
  }
  const device = await requestDeviceCode(signal);
  interaction.notify({
    type: "device_code",
    userCode: device.userCode,
    verificationUri: device.verificationUri,
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
  });
  return pollForTokens(device, signal);
}

async function requestDeviceCode(signal: AbortSignal): Promise<DeviceCode> {
  const response = await postForm(
    XAI_DEVICE_CODE_URL,
    {
      client_id: XAI_CLIENT_ID,
      scope: XAI_SCOPES.join(" "),
      referrer: XAI_REFERRER,
    },
    signal,
  );
  if (!response.ok) throw requestFailure("device authorization", response);
  return parseDeviceCode(response.body);
}

async function pollForTokens(
  device: DeviceCode,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  const deadline = Date.now() + device.expiresInSeconds * 1000;
  let intervalMs = Math.max(
    MIN_POLL_INTERVAL_MS,
    Math.floor(
      (device.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000,
    ),
  );
  let slowDowns = 0;
  const remaining = () => deadline - Date.now();
  if (remaining() > 0) {
    await abortableSleep(Math.min(intervalMs, remaining()), signal);
  }
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error(CANCELLED);
    const response = await postForm(
      XAI_TOKEN_URL,
      {
        grant_type: DEVICE_GRANT_TYPE,
        client_id: XAI_CLIENT_ID,
        device_code: device.deviceCode,
      },
      signal,
    );
    if (response.ok) return credentialsFromTokenResponse(response.body);
    const error = stringField(response.body, "error");
    if (error === "authorization_pending") {
      // keep polling
    } else if (error === "slow_down") {
      slowDowns += 1;
      const serverInterval = response.body.interval;
      intervalMs =
        typeof serverInterval === "number" &&
        Number.isFinite(serverInterval) &&
        serverInterval > 0
          ? Math.max(MIN_POLL_INTERVAL_MS, Math.floor(serverInterval * 1000))
          : Math.max(MIN_POLL_INTERVAL_MS, intervalMs + SLOW_DOWN_INCREMENT_MS);
    } else if (error === "access_denied" || error === "authorization_denied") {
      throw new Error("xAI device authorization was denied");
    } else if (error === "expired_token") {
      throw new Error("xAI device code expired");
    } else {
      throw requestFailure("device token polling", response);
    }
    if (remaining() <= 0) break;
    await abortableSleep(Math.min(intervalMs, remaining()), signal);
  }
  throw new Error(
    slowDowns > 0
      ? "Device flow timed out after one or more slow_down responses. This is often caused by clock drift in WSL or VM environments. Please sync or restart the VM clock and try again."
      : "Device flow timed out",
  );
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; body: JsonObject }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "x-grok-client-surface": XAI_CLIENT_SURFACE,
      },
      body: new URLSearchParams(fields),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new Error(CANCELLED);
    throw error;
  }
  let body: JsonObject = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as JsonObject;
    }
  } catch {
    if (signal.aborted) throw new Error(CANCELLED);
    throw new Error(
      `xAI OAuth returned invalid JSON (HTTP ${response.status})`,
    );
  }
  return { ok: response.ok, status: response.status, body };
}

function parseDeviceCode(body: JsonObject): DeviceCode {
  const interval = body.interval;
  const complete = stringField(body, "verification_uri_complete");
  return {
    deviceCode: requiredString(body, "device_code"),
    userCode: validateUserCode(requiredString(body, "user_code")),
    verificationUri: validateVerificationUri(
      complete ?? requiredString(body, "verification_uri"),
    ),
    intervalSeconds:
      typeof interval === "number" && Number.isFinite(interval) && interval > 0
        ? interval
        : undefined,
    expiresInSeconds: positiveNumber(body, "expires_in"),
  };
}

function credentialsFromTokenResponse(body: JsonObject): OAuthCredential {
  const expiresInSeconds =
    body.expires_in === undefined
      ? DEFAULT_TOKEN_LIFETIME_SECONDS
      : positiveNumber(body, "expires_in");
  return {
    type: "oauth",
    access: requiredString(body, "access_token"),
    refresh: requiredString(body, "refresh_token"),
    expires: Date.now() + expiresInSeconds * 1000 - REFRESH_SKEW_MS,
  };
}

function requestFailure(
  action: string,
  response: { status: number; body: JsonObject },
): Error {
  const detail = [
    stringField(response.body, "error"),
    stringField(response.body, "error_description"),
  ]
    .filter((part) => part !== undefined)
    .join(": ");
  return new Error(
    `xAI OAuth ${action} failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
  );
}

function requiredString(body: JsonObject, field: string): string {
  const value = stringField(body, field);
  if (!value) throw new Error(`Invalid xAI OAuth response field: ${field}`);
  return value;
}

function stringField(body: JsonObject, field: string): string | undefined {
  const value = body[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function positiveNumber(body: JsonObject, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid xAI OAuth response field: ${field}`);
  }
  return value;
}

function validateUserCode(raw: string): string {
  if (![...raw].every((char) => /[A-Za-z0-9-]/.test(char))) {
    throw new Error("xAI OAuth returned an invalid user code");
  }
  return raw;
}

function validateVerificationUri(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Untrusted verification URI in xAI OAuth response");
  }
  if (url.protocol !== "https:") {
    throw new Error("Untrusted verification URI in xAI OAuth response");
  }
  return url.href;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(CANCELLED));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error(CANCELLED));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
