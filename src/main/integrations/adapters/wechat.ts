import { writeFile } from "fs/promises";
import { join } from "path";
import type { MessageItem, WeixinMessage } from "wechat-ilink-client";
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
    if (!client) throw new Error("WeChat client is not connected.");
    await client.sendMedia(
      session.sessionId,
      filePath,
      caption,
      session.replyContext,
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
