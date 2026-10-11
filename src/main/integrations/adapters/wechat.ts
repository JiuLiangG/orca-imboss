import { createHash, randomBytes } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { basename, join } from "path";
import type {
  GetUploadUrlResp,
  MessageItem,
  UploadedFileInfo,
  WeixinMessage,
} from "wechat-ilink-client";
import type { WechatConfig } from "../store";
import { chunkText } from "../format";
import { mimeByFileName, safeFileName } from "../media";
import type {
  AdapterCallbacks,
  AdapterSession,
  InboundMedia,
  IntegrationAdapter,
} from "../types";
import { errorMessage } from "../util";

/**
 * WeChat adapter — official iLink Bot API (`wechat-ilink-client`).
 *
 * The SDK is ESM-only, so it is loaded through a cached dynamic import (the
 * main bundle is CJS). The library is stateless: credential + cursor
 * persistence is handled here via the `integrations.json` store.
 *
 * A conversation is identified by the stable `from_user_id`; the per-message
 * `context_token` is forwarded as the reply credential.
 */

const MAX_MESSAGE_LENGTH = 2000;

/**
 * CDN upload policy: retry transient failures (mirrors the official plugin),
 * abort immediately on client errors, and cap every attempt so a hung
 * connection can never stall the forwarding loop indefinitely.
 */
const UPLOAD_MAX_RETRIES = 3;
const UPLOAD_TIMEOUT_MS = 120_000;

type IlinkSdk = typeof import("wechat-ilink-client");
type IlinkClient = InstanceType<IlinkSdk["WeChatClient"]>;

export class WechatAdapter implements IntegrationAdapter {
  readonly platform = "wechat" as const;

  private running = false;
  private sdk: IlinkSdk | null = null;
  private client: IlinkClient | null = null;
  private sdkPromise: Promise<IlinkSdk> | null = null;
  private lastQrImage = "";

  constructor(
    private readonly config: WechatConfig,
    private readonly callbacks: AdapterCallbacks,
  ) {}

  async start(): Promise<void> {
    if (!this.config.botToken) {
      // Enabled but not logged in: the renderer shows the QR login action.
      this.callbacks.onState("loginRequired");
      return;
    }
    const client = await this.ensureClient();
    this.running = true;
    this.callbacks.onState("connecting");
    this.callbacks.onState("connected", this.config.accountId ?? null);
    void this.monitor(client);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.client?.stop();
    this.client = null;
    this.callbacks.onState("disabled");
  }

  async login(): Promise<void> {
    const client = await this.ensureClient();
    this.callbacks.onState("connecting");
    const result = await client.login({
      onQRCode: async (url) => {
        this.lastQrImage = url;
        await this.emitQr(url, "wait");
      },
      onStatus: async (status) => {
        await this.emitQr(this.lastQrImage, status);
      },
    });
    if (!result.connected) {
      throw new Error(result.message || "WeChat login failed.");
    }
    this.config.botToken = result.botToken;
    this.config.accountId = result.accountId;
    this.config.baseUrl = result.baseUrl;
    this.config.userId = result.userId;
    this.callbacks.onConfigDirty();
    this.callbacks.onQr?.("", "confirmed");
    this.running = true;
    this.callbacks.onState("connected", result.accountId ?? null);
    void this.monitor(client);
  }

  async logout(): Promise<void> {
    await this.stop();
    this.config.botToken = undefined;
    this.config.accountId = undefined;
    this.config.baseUrl = undefined;
    this.config.userId = undefined;
    this.config.syncBuf = undefined;
    this.callbacks.onConfigDirty();
    this.callbacks.onState("loginRequired");
  }

  async sendText(session: AdapterSession, text: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error("WeChat client is not connected.");
    for (const chunk of chunkText(text, MAX_MESSAGE_LENGTH)) {
      if (chunk.trim().length === 0) continue;
      await client.sendText(session.sessionId, chunk, session.replyContext);
    }
  }

  async sendMedia(
    session: AdapterSession,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    if (!client) throw new Error("WeChat client is not connected.");
    if (!sdk) throw new Error("WeChat SDK is not available.");
    // The SDK's own `sendMedia` only understands `upload_param`, which the
    // server no longer returns, so upload here and send the media ourselves.
    const uploaded = await uploadWechatMedia(
      sdk,
      client.api,
      filePath,
      session.sessionId,
    );
    const mime = sdk.getMimeFromFilename(filePath);
    const context = session.replyContext;
    if (mime.startsWith("image/")) {
      await client.sendUploadedImage(
        session.sessionId,
        uploaded,
        caption,
        context,
      );
      return;
    }
    if (mime.startsWith("video/")) {
      await client.sendUploadedVideo(
        session.sessionId,
        uploaded,
        caption,
        context,
      );
      return;
    }
    await client.sendUploadedFile(
      session.sessionId,
      basename(filePath),
      uploaded,
      caption,
      context,
    );
  }

  private async monitor(client: IlinkClient): Promise<void> {
    try {
      await client.start({
        loadSyncBuf: () => this.config.syncBuf,
        saveSyncBuf: (buf) => {
          this.config.syncBuf = buf;
          this.callbacks.onConfigDirty();
        },
      });
    } catch (err) {
      if (this.running) this.callbacks.onState("error", errorMessage(err));
    }
  }

  private async ensureClient(): Promise<IlinkClient> {
    if (this.client) return this.client;
    const sdk = await this.loadSdk();
    const client = new sdk.WeChatClient({
      ...(this.config.botToken ? { token: this.config.botToken } : {}),
      ...(this.config.accountId ? { accountId: this.config.accountId } : {}),
      ...(this.config.baseUrl ? { baseUrl: this.config.baseUrl } : {}),
    });
    client.on("message", (msg) => this.handleMessage(msg));
    client.on("error", (err) => {
      this.callbacks.onState("error", errorMessage(err));
    });
    client.on("sessionExpired", () => this.handleSessionExpired());
    this.client = client;
    return client;
  }

  /** Convert the raw QR payload into an embeddable image and emit it. */
  private async emitQr(content: string, status: string): Promise<void> {
    // Once confirmed the QR must disappear and stay hidden until the next
    // login attempt — never re-emit the last image on the status callback.
    if (content.length === 0 || status === "confirmed") {
      this.callbacks.onQr?.("", status);
      return;
    }
    this.callbacks.onQr?.(await toQrImage(content), status);
  }

  private handleSessionExpired(): void {
    this.running = false;
    this.callbacks.onState(
      "loginRequired",
      "WeChat session expired — scan the QR code again.",
    );
    this.client?.stop();
  }

  private handleMessage(msg: WeixinMessage): void {
    const sdk = this.sdk;
    if (!sdk || msg.message_type !== sdk.MessageType.USER) return;
    const from = msg.from_user_id;
    if (!from) return;
    const text = sdk.WeChatClient.extractText(msg).trim();
    this.callbacks.onMessage({
      sessionId: from,
      senderId: from,
      senderName: `WeChat ${from}`,
      text,
      ...(msg.context_token ? { replyContext: msg.context_token } : {}),
      kind: "private",
      media: this.collectMedia(msg, sdk),
    });
  }

  private collectMedia(msg: WeixinMessage, sdk: IlinkSdk): InboundMedia[] {
    const media: InboundMedia[] = [];
    for (const item of msg.item_list ?? []) {
      if (!sdk.WeChatClient.isMediaItem(item)) continue;
      const kind = itemKind(item, sdk);
      const fileName =
        item.file_item?.file_name ?? `${kind}_${msg.message_id ?? Date.now()}`;
      media.push({
        kind,
        fileName,
        mime: mimeByFileName(fileName),
        save: async (targetDir) => {
          const client = this.client;
          if (!client) return null;
          const downloaded = await client.downloadMedia(item);
          if (!downloaded) return null;
          const name = downloaded.fileName ?? fileName;
          const target = join(targetDir, safeFileName(name));
          await writeFile(target, downloaded.data);
          return { path: target, size: downloaded.data.length };
        },
      });
    }
    return media;
  }

  private loadSdk(): Promise<IlinkSdk> {
    this.sdkPromise ??= import("wechat-ilink-client")
      .then((sdk) => {
        this.sdk = sdk;
        return sdk;
      })
      .catch((err) => {
        this.sdkPromise = null;
        throw err;
      });
    return this.sdkPromise;
  }
}

/**
 * Upload one local file to the WeChat CDN.
 *
 * `wechat-ilink-client@0.1.0` builds its upload URL only from `upload_param`,
 * but the iLink server now returns `upload_full_url` instead, so the SDK's own
 * `sendMedia` throws before anything is sent. This mirrors the official
 * Tencent plugin: use `upload_full_url` verbatim when present, otherwise fall
 * back to a URL built from `upload_param` + `filekey`. The result matches the
 * SDK's `UploadedFileInfo`, so the public `sendUploaded*` methods can send it.
 */
async function uploadWechatMedia(
  sdk: IlinkSdk,
  api: IlinkClient["api"],
  filePath: string,
  toUserId: string,
): Promise<UploadedFileInfo> {
  const mime = sdk.getMimeFromFilename(filePath);
  const plaintext = await readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = createHash("md5").update(plaintext).digest("hex");
  const filesize = sdk.aesEcbPaddedSize(rawsize);
  const filekey = randomBytes(16).toString("hex");
  const aeskey = randomBytes(16);
  const mediaType = mime.startsWith("video/")
    ? sdk.UploadMediaType.VIDEO
    : mime.startsWith("image/")
      ? sdk.UploadMediaType.IMAGE
      : sdk.UploadMediaType.FILE;
  const response = await api.getUploadUrl({
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });
  return {
    filekey,
    downloadEncryptedQueryParam: await uploadCiphertext(
      sdk,
      resolveUploadUrl(sdk, api.cdnBaseUrl, response, filekey),
      plaintext,
      aeskey,
    ),
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

/** Server-provided `upload_full_url` wins; otherwise build it client-side. */
function resolveUploadUrl(
  sdk: IlinkSdk,
  cdnBaseUrl: string,
  response: GetUploadUrlResp,
  filekey: string,
): string {
  // The server returns `upload_full_url` but it is absent from the 0.1.0
  // typings, so read it defensively rather than casting the whole response.
  const full = (response as { upload_full_url?: unknown }).upload_full_url;
  if (typeof full === "string" && full.trim().length > 0) return full.trim();
  const param =
    typeof response.upload_param === "string" ? response.upload_param : "";
  if (param.length > 0) {
    return sdk.buildCdnUploadUrl({ cdnBaseUrl, uploadParam: param, filekey });
  }
  throw new Error("getUploadUrl returned no upload URL.");
}

/** POST the AES-128-ECB ciphertext to the CDN; return `x-encrypted-param`. */
async function uploadCiphertext(
  sdk: IlinkSdk,
  url: string,
  plaintext: Buffer,
  aeskey: Buffer,
): Promise<string> {
  const body = new Uint8Array(sdk.encryptAesEcb(plaintext, aeskey));
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body,
        signal: controller.signal,
      });
      if (res.status >= 400 && res.status < 500) {
        const detail =
          res.headers.get("x-error-message") ??
          (await res.text().catch(() => ""));
        throw new NonRetryableUploadError(
          `CDN upload rejected (${res.status}): ${detail}`,
        );
      }
      if (res.status !== 200) {
        const detail =
          res.headers.get("x-error-message") ?? `status ${res.status}`;
        throw new Error(`CDN upload failed: ${detail}`);
      }
      const parameter = res.headers.get("x-encrypted-param");
      if (!parameter) {
        throw new NonRetryableUploadError(
          "CDN upload response missing x-encrypted-param.",
        );
      }
      return parameter;
    } catch (err) {
      if (err instanceof NonRetryableUploadError) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("CDN upload failed.");
}

/** A CDN failure that must never be retried (bad request / bad response). */
class NonRetryableUploadError extends Error {}

/**
 * iLink's `qrcode_img_content` may be a QR image URL or the raw content to
 * encode. Pass image sources through and encode everything else into a data
 * URL so the renderer can always use a plain `<img>`.
 */
async function toQrImage(content: string): Promise<string> {
  if (content.startsWith("data:image/")) return content;
  if (/^https?:\/\/[^\s]+\.(png|jpe?g|gif|svg|webp)(\?.*)?$/i.test(content)) {
    return content;
  }
  try {
    const qrcode = await import("qrcode");
    return await qrcode.toDataURL(content, { margin: 1, width: 240 });
  } catch (err) {
    console.error(
      "[integrations:wechat] failed to render QR:",
      errorMessage(err),
    );
    return content;
  }
}

function itemKind(item: MessageItem, sdk: IlinkSdk): InboundMedia["kind"] {
  switch (item.type) {
    case sdk.MessageItemType.IMAGE:
      return "image";
    case sdk.MessageItemType.VIDEO:
      return "video";
    case sdk.MessageItemType.VOICE:
      return "voice";
    default:
      return "file";
  }
}
