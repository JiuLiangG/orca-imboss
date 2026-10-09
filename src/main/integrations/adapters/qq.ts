import { writeFile } from "fs/promises";
import { join } from "path";
import { getDataRoot } from "../../data-dir";
import type { QqConfig } from "../store";
import { chunkText } from "../format";
import { mimeByFileName, safeFileName } from "../media";
import type {
  AdapterCallbacks,
  AdapterSession,
  InboundMedia,
  IntegrationAdapter,
} from "../types";
import { errorMessage, fileNameFromPath } from "../util";

/**
 * QQ adapter — official QQ Bot platform over the WebSocket gateway
 * (`qq-official-bot`). Uses the C2C + group intents and openid identities.
 *
 * The SDK is loaded lazily (dynamic import) so app startup is unaffected; the
 * adapter talks to it through a narrow local interface.
 */

const MAX_MESSAGE_LENGTH = 1000;
const DEDUP_LIMIT = 500;

type QqSdk = typeof import("qq-official-bot");
type QqBot = InstanceType<QqSdk["Bot"]>;
type QqSendable = Parameters<InstanceType<QqSdk["Bot"]>["sendGroupMessage"]>[1];
type QqQuotable = { id?: string; event_id?: string };

/** Minimal shape of the parsed message event we consume. */
interface QqElement {
  type: string;
  data?: { text?: string; url?: string; name?: string };
}

interface QqEvent {
  message_id?: string;
  event_id?: string;
  group_id?: string;
  user_id?: string;
  sender?: { user_name?: string; user_openid?: string };
  author?: { user_openid?: string; member_openid?: string };
  message?: QqElement[];
}

export class QqAdapter implements IntegrationAdapter {
  readonly platform = "qq" as const;

  private bot: QqBot | null = null;
  private sdkPromise: Promise<QqSdk> | null = null;
  private readonly seen = new Set<string>();

  constructor(
    private readonly config: QqConfig,
    private readonly callbacks: AdapterCallbacks,
  ) {}

  async start(): Promise<void> {
    if (!this.config.appId || !this.config.secret) {
      throw new Error("QQ App ID and Secret are not configured.");
    }
    this.callbacks.onState("connecting");
    const sdk = await this.loadSdk();
    const bot: QqBot = new sdk.Bot({
      appid: this.config.appId,
      secret: this.config.secret,
      intents: ["GROUP_AND_C2C_EVENT"],
      mode: sdk.ReceiverMode.WEBSOCKET,
      logLevel: "error",
      // Keep any SDK session state inside the app's data folder.
      dataDir: join(getDataRoot(), "integrations"),
    });
    bot.on("message.private", (event) =>
      this.handle(event as unknown as QqEvent, false),
    );
    bot.on("message.group", (event) =>
      this.handle(event as unknown as QqEvent, true),
    );
    this.bot = bot;
    await bot.start();
    this.callbacks.onState("connected", this.config.appId);
  }

  async stop(): Promise<void> {
    const bot = this.bot;
    this.bot = null;
    if (bot) {
      try {
        await bot.stop();
      } catch (err) {
        console.error("[integrations:qq] stop failed:", errorMessage(err));
      }
    }
    this.callbacks.onState("disabled");
  }

  async sendText(session: AdapterSession, text: string): Promise<void> {
    const source = parseReplyContext(session.replyContext);
    for (const chunk of chunkText(text, MAX_MESSAGE_LENGTH)) {
      if (chunk.trim().length === 0) continue;
      await this.send(session.sessionId, chunk, source);
    }
  }

  async sendMedia(
    session: AdapterSession,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    const sdk = await this.loadSdk();
    const name = fileNameFromPath(filePath);
    const mime = mimeByFileName(name);
    let element: QqSendable;
    if (mime.startsWith("image/")) {
      element = sdk.segment.image(filePath);
    } else if (mime.startsWith("video/")) {
      element = sdk.segment.video(filePath);
    } else if (mime.startsWith("audio/")) {
      element = sdk.segment.audio(filePath);
    } else {
      // QQ has no generic file segment here — degrade to a text note.
      const note =
        caption && caption.trim().length > 0
          ? `${caption}\n[${name}]`
          : `[${name}]`;
      await this.sendText(session, note);
      return;
    }
    if (caption && caption.trim().length > 0) {
      await this.sendText(session, caption);
    }
    await this.send(
      session.sessionId,
      element,
      parseReplyContext(session.replyContext),
    );
  }

  private handle(event: QqEvent, isGroup: boolean): void {
    const messageId = event.message_id ?? event.event_id;
    if (messageId) {
      if (this.seen.has(messageId)) return;
      this.seen.add(messageId);
      if (this.seen.size > DEDUP_LIMIT) {
        const oldest = this.seen.values().next().value;
        if (oldest !== undefined) this.seen.delete(oldest);
      }
    }
    const senderId =
      event.sender?.user_openid ??
      event.author?.user_openid ??
      event.author?.member_openid ??
      event.user_id ??
      "";
    const sessionId = isGroup
      ? `group:${event.group_id ?? ""}`
      : `c2c:${senderId}`;
    const replyContext =
      event.message_id || event.event_id
        ? JSON.stringify({
            id: event.message_id,
            event_id: event.event_id,
          } satisfies QqQuotable)
        : undefined;
    const senderName =
      event.sender?.user_name ??
      (isGroup ? `QQ ${event.group_id ?? ""}` : `QQ ${senderId}`);
    this.callbacks.onMessage({
      sessionId,
      senderId,
      senderName,
      text: extractText(event),
      ...(replyContext ? { replyContext } : {}),
      kind: isGroup ? "group" : "private",
      media: extractMedia(event),
    });
  }

  /** Route a C2C/group send, retrying without the passive-reply source. */
  private async send(
    sessionId: string,
    message: QqSendable,
    source: QqQuotable | undefined,
  ): Promise<void> {
    const bot = this.bot;
    if (!bot) throw new Error("QQ bot is not connected.");
    const target = parseSession(sessionId);
    const entry =
      target.kind === "group" ? bot.group(target.id) : bot.user(target.id);
    try {
      await entry.send(message, source);
    } catch (err) {
      // A stale passive-reply source (window expired) must not drop the reply:
      // retry as an active message.
      if (source) {
        await entry.send(message);
        return;
      }
      throw err;
    }
  }

  private loadSdk(): Promise<QqSdk> {
    this.sdkPromise ??= import("qq-official-bot") as Promise<QqSdk>;
    return this.sdkPromise;
  }
}

function parseSession(sessionId: string): {
  kind: "c2c" | "group";
  id: string;
} {
  const separator = sessionId.indexOf(":");
  const kind = sessionId.slice(0, separator);
  const id = sessionId.slice(separator + 1);
  return { kind: kind === "group" ? "group" : "c2c", id };
}

function parseReplyContext(
  context: string | undefined,
): QqQuotable | undefined {
  if (!context) return undefined;
  try {
    const parsed = JSON.parse(context) as QqQuotable;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function extractText(event: QqEvent): string {
  const parts: string[] = [];
  for (const element of event.message ?? []) {
    if (element.type === "text" && element.data?.text) {
      parts.push(element.data.text);
    }
  }
  return parts.join("").trim();
}

function extractMedia(event: QqEvent): InboundMedia[] {
  const media: InboundMedia[] = [];
  for (const element of event.message ?? []) {
    const url = element.data?.url;
    if (!url) continue;
    const kind = mediaKind(element.type);
    const fileName =
      element.data?.name ?? `${kind}_${event.message_id ?? Date.now()}`;
    media.push({
      kind,
      fileName,
      mime: mimeByFileName(fileName),
      save: async (targetDir) => {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = Buffer.from(await res.arrayBuffer());
        const target = join(targetDir, safeFileName(fileName));
        await writeFile(target, data);
        return { path: target, size: data.length };
      },
    });
  }
  return media;
}

function mediaKind(type: string): InboundMedia["kind"] {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
    case "voice":
      return "voice";
    default:
      return "file";
  }
}
