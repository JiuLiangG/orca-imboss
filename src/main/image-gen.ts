import { SettingKeys } from "@shared/constants/settings";
import type { Message, ProviderApiType } from "@shared/types";
import { listProviders, revealProviderKey } from "./agent/providers";
import { deleteAttachmentFile, savePastedFile } from "./attachments";
import * as dbMessages from "./db/messages";
import { getSetting } from "./db/settings";

/**
 * App-owned image generation.
 *
 * Every other model call in this app goes through the Pi SDK, which reads its
 * own catalog (`auth.json` / `models.json`). That SDK is a coding agent and has
 * no image API, so generating a picture needs a call the app makes itself — this
 * module is that call. It deliberately reuses the configuration the app already
 * owns: the same credential store, the same base URL / api type, and the
 * process-wide HTTP proxy (`http-proxy.ts`) that every main-process `fetch`
 * inherits.
 *
 * Two request shapes cover the field:
 * - OpenAI-compatible `POST {base}/images/generations` — OpenAI itself, plus any
 *   compatible endpoint (OpenRouter's image catalog, NewAPI / one-api / LiteLLM
 *   gateways, Meta…);
 * - Google `POST {base}/models/{model}:generateContent` — the Nano Banana
 *   family. (Imagen is shut down upstream; it is not supported here.)
 *
 * Credentials never leave this process: the key is read per request and is only
 * ever put in an `Authorization` / `x-goog-api-key` header.
 */

/** A configured image model: `"<provider>/<modelId>"`. */
export interface ImageModelRef {
  provider: string;
  model: string;
}

export interface GeneratedImage {
  bytes: Buffer;
  mime: string;
}

/** Image models are slow; a hung provider must not pin the tool forever. */
const REQUEST_TIMEOUT_MS = 180_000;

/** Cap on the provider's error body echoed back to the caller. */
const MAX_ERROR_DETAIL = 300;

/**
 * Endpoints for curated (built-in) providers.
 *
 * The app does not know a built-in provider's base URL — that lives in the Pi
 * SDK's bundled catalog — so this map carries the few the image client can
 * reach. Custom providers need no entry: their base URL and api type are stored
 * in `models.json` and are used as-is, which is how an OpenAI-compatible gateway
 * (or OpenRouter added as a custom provider) is supported without code changes.
 */
const BUILTIN_IMAGE_ENDPOINTS: Record<
  string,
  { baseUrl: string; apiType: ProviderApiType }
> = {
  openai: { baseUrl: "https://api.openai.com/v1", apiType: "openai-responses" },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiType: "google-generative-ai",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiType: "openai-completions",
  },
  xai: { baseUrl: "https://api.x.ai/v1", apiType: "openai-completions" },
};

/** `"provider/modelId"` for a stored setting value, or `null` when unusable. */
export function parseImageModelRef(
  value: string | null | undefined,
): ImageModelRef | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return null;
  const at = trimmed.indexOf("/");
  if (at <= 0 || at === trimmed.length - 1) return null;
  return { provider: trimmed.slice(0, at), model: trimmed.slice(at + 1) };
}

/** Inverse of `parseImageModelRef`. */
export function imageModelRef(ref: ImageModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

/** The configured image model, or `null` when none has been picked yet. */
export function getImageModelRef(): ImageModelRef | null {
  return parseImageModelRef(getSetting(SettingKeys.ImageModel));
}

/**
 * Generate one picture. `size` is the OpenAI-style `"1024x1024"` string; the
 * Google backend has no equivalent knob on this endpoint and generates at the
 * model's own default resolution.
 */
export async function generateImage(
  ref: ImageModelRef,
  prompt: string,
  size: string,
): Promise<GeneratedImage> {
  const endpoint = await resolveEndpoint(ref.provider);
  switch (endpoint.apiType) {
    case "google-generative-ai":
      return requestGoogleImage(endpoint, ref.model, prompt);
    case "openai-completions":
    case "openai-responses":
      return requestOpenAiImage(endpoint, ref.model, prompt, size);
    default:
      throw new Error(
        `Provider "${ref.provider}" (${endpoint.apiType}) has no image generation API.`,
      );
  }
}

interface ResolvedEndpoint {
  baseUrl: string;
  apiType: ProviderApiType;
  apiKey: string;
}

/** Resolve a provider's image endpoint + credential, or explain why it cannot. */
async function resolveEndpoint(provider: string): Promise<ResolvedEndpoint> {
  const apiKey = await revealProviderKey(provider);
  if (apiKey === null || apiKey.length === 0) {
    throw new Error(`No API key is configured for provider "${provider}".`);
  }
  const info = (await listProviders()).find((entry) => entry.id === provider);
  if (info?.kind === "custom") {
    if (!info.baseUrl || !info.apiType) {
      throw new Error(
        `Provider "${provider}" has no base URL / API type configured.`,
      );
    }
    return { baseUrl: info.baseUrl, apiType: info.apiType, apiKey };
  }
  const builtin = BUILTIN_IMAGE_ENDPOINTS[provider];
  if (!builtin) {
    throw new Error(
      `Provider "${provider}" is not supported for image generation yet.`,
    );
  }
  return { ...builtin, apiKey };
}

/** OpenAI-compatible `POST {base}/images/generations`. */
async function requestOpenAiImage(
  endpoint: ResolvedEndpoint,
  model: string,
  prompt: string,
  size: string,
): Promise<GeneratedImage> {
  const url = `${trimBase(endpoint.baseUrl)}/images/generations`;
  const body = await fetchJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  });

  const data = Array.isArray(body.data) ? body.data : [];
  const first = data[0] as { b64_json?: unknown; url?: unknown } | undefined;
  if (!first) throw new Error("The image model returned no image.");
  if (typeof first.b64_json === "string" && first.b64_json.length > 0) {
    return { bytes: Buffer.from(first.b64_json, "base64"), mime: "image/png" };
  }
  if (typeof first.url === "string" && first.url.length > 0) {
    return fetchImage(first.url);
  }
  throw new Error("The image model returned no image data.");
}

/** Google `POST {base}/models/{model}:generateContent`. */
async function requestGoogleImage(
  endpoint: ResolvedEndpoint,
  model: string,
  prompt: string,
): Promise<GeneratedImage> {
  const url = `${trimBase(endpoint.baseUrl)}/models/${encodeURIComponent(model)}:generateContent`;
  const body = await fetchJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": endpoint.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });

  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const parts =
    (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content
      ?.parts ?? [];
  for (const part of Array.isArray(parts) ? parts : []) {
    const inline =
      (part as { inlineData?: unknown; inline_data?: unknown }).inlineData ??
      (part as { inline_data?: unknown }).inline_data;
    const data = (inline as { data?: unknown } | undefined)?.data;
    if (typeof data === "string" && data.length > 0) {
      const mime = (inline as { mimeType?: unknown }).mimeType;
      return {
        bytes: Buffer.from(data, "base64"),
        mime: typeof mime === "string" && mime.length > 0 ? mime : "image/png",
      };
    }
  }
  throw new Error("The image model returned no image.");
}

/** Download an image the provider handed back as a URL. */
async function fetchImage(url: string): Promise<GeneratedImage> {
  const res = await request(url, { method: "GET" });
  const type = res.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("The image model returned no image.");
  return {
    bytes,
    mime: type.startsWith("image/") ? type.split(";")[0] : "image/png",
  };
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await request(url, init);
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("The image model returned a non-JSON response.");
  }
}

/** One HTTP call with the shared timeout and error mapping. */
async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "AbortError"
        ? "Image generation timed out."
        : "Could not reach the image model.",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Image generation failed (HTTP ${res.status})${errorDetail(detail)}`,
    );
  }
  return res;
}

/** Short, single-line echo of a provider's error body. */
function errorDetail(body: string): string {
  const cleaned = body.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_DETAIL);
  return cleaned.length > 0 ? `: ${cleaned}` : "";
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Default output size when the caller does not ask for one. */
export const DEFAULT_IMAGE_SIZE = "1024x1024";
/** `"<width>x<height>"`, the shape every OpenAI-compatible endpoint takes. */
const IMAGE_SIZE_RE = /^\d{2,5}x\d{2,5}$/;

/** Keep a requested size sane; anything else falls back to the default. */
export function normalizeImageSize(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return IMAGE_SIZE_RE.test(trimmed) ? trimmed : DEFAULT_IMAGE_SIZE;
}

/** Attachment file name for a generated picture (extension from its MIME). */
function imageFileName(mime: string): string {
  const ext =
    mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  return `imboss-image-${Date.now()}.${ext}`;
}

/**
 * Delete the pictures a row dropped. A row keeps the newest
 * `MAX_IMAGE_GENERATIONS` generations, so anything it carried before and no
 * longer carries has just fallen off the cap — leaving those files behind would
 * be orphaned disk that nothing references.
 */
function dropSupersededFiles(
  before: Message | null,
  after: Message | null,
): void {
  if (after === null) return;
  const kept = new Set(
    (after.attachments ?? []).map((attachment) => attachment.path),
  );
  for (const attachment of before?.attachments ?? []) {
    if (typeof attachment.path === "string" && !kept.has(attachment.path)) {
      deleteAttachmentFile(attachment.path);
    }
  }
}

/**
 * Draw `prompt` into an image message that is already in its `generating`
 * state. Shared by the tool (which appends the placeholder first) and by the
 * boss's re-roll (which reuses a finished row).
 *
 * A failure keeps whatever picture the row already had: a re-roll that fails
 * must not destroy the picture the boss is looking at, so the row goes back to
 * `done` and the caller surfaces the reason instead.
 */
export async function drawIntoImageMessage(
  messageId: number,
  ref: ImageModelRef,
  prompt: string,
  size: string,
): Promise<Message | null> {
  const previous = dbMessages.getMessageById(messageId);
  try {
    const image = await generateImage(ref, prompt, size);
    const message = dbMessages.getMessageById(messageId);
    if (message === null) return null;
    const attachment = savePastedFile(
      message.chatId,
      imageFileName(image.mime),
      image.mime,
      image.bytes,
    );
    const updated = dbMessages.updateImageGeneration(messageId, {
      status: "done",
      attachment,
      imageModel: imageModelRef(ref),
    });
    dropSupersededFiles(previous, updated);
    return updated;
  } catch (err) {
    dbMessages.updateImageGeneration(messageId, {
      status: hasPicture(previous) ? "done" : "error",
    });
    throw err;
  }
}

/** True when the row already carries a picture. */
function hasPicture(message: Message | null): boolean {
  const path = message?.attachments?.[0]?.path;
  return typeof path === "string" && path.length > 0;
}

/**
 * Re-roll a finished (or failed) image message with the prompt it already
 * carries — the boss's "draw it again". The row goes back to `generating`, so
 * the chat shows the placeholder again until the new picture lands.
 */
export async function rerollImageMessage(
  messageId: number,
): Promise<Message | null> {
  const message = dbMessages.getMessageById(messageId);
  if (message === null) return null;
  if (message.kind !== "image") {
    throw new Error("Only image messages can be redrawn.");
  }
  const ref = getImageModelRef();
  if (ref === null) {
    throw new Error(
      "No image model is configured. Choose one under Settings › Providers › Image generation model.",
    );
  }
  if (
    dbMessages.updateImageGeneration(messageId, { status: "generating" }) ===
    null
  ) {
    return null;
  }
  return drawIntoImageMessage(
    messageId,
    ref,
    message.content,
    DEFAULT_IMAGE_SIZE,
  );
}
