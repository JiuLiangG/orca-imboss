import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { TelegramConfig } from "../store";
import { chunkText } from "../format";
import { mimeByFileName, safeFileName } from "../media";
import type {
  AdapterCallbacks,
  AdapterSession,
  InboundMedia,
  IntegrationAdapter,
} from "../types";
import { delay, errorMessage, fileNameFromPath } from "../util";

/**
 * Telegram adapter — raw Bot API long-poll (`getUpdates`) over global `fetch`.
 * No wrapper dependency; a bot token from @BotFather is the only credential.
 */

const API_BASE = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;
const POLL_TIMEOUT_SECONDS = 30;
const ERROR_BACKOFF_MS = 3000;

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgChat {
  id: number;
  type: string;
  title?: string;
}

interface TgFileRef {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string }>;
  document?: TgFileRef;
  voice?: TgFileRef;
  audio?: TgFileRef;
  video?: TgFileRef;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export class TelegramAdapter implements IntegrationAdapter {
  readonly platform = "telegram" as const;

  private running = false;
  private controller: AbortController | null = null;
  private account: string | null = null;

  constructor(
    private readonly config: TelegramConfig,
    private readonly callbacks: AdapterCallbacks,
  ) {}

  async start(): Promise<void> {
    if (!this.config.botToken) {
      throw new Error("Telegram bot token is not configured.");
    }
    this.callbacks.onState("connecting");
    const me = await this.call<{ username?: string; first_name?: string }>(
      "getMe",
    );
    this.account = me.username ? `@${me.username}` : (me.first_name ?? null);
    this.running = true;
    this.controller = new AbortController();
    this.callbacks.onState("connected", this.account);
    void this.pollLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
    this.callbacks.onState("disabled");
  }

  async sendText(session: AdapterSession, text: string): Promise<void> {
    for (const chunk of chunkText(text, MAX_MESSAGE_LENGTH)) {
      if (chunk.trim().length === 0) continue;
      await this.call("sendMessage", {
        chat_id: session.sessionId,
        text: chunk,
      });
    }
  }

  async sendMedia(
    session: AdapterSession,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    const data = await readFile(filePath);
    const fileName = fileNameFromPath(filePath);
    const mime = mimeByFileName(fileName);
    const isImage = mime.startsWith("image/");
    const form = new FormData();
    form.append("chat_id", session.sessionId);
    if (caption && caption.trim().length > 0) {
      form.append("caption", caption.slice(0, MAX_CAPTION_LENGTH));
    }
    form.append(
      isImage ? "photo" : "document",
      new Blob([new Uint8Array(data)], { type: mime }),
      safeFileName(fileName),
    );
    await this.callForm(isImage ? "sendPhoto" : "sendDocument", form);
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.call<TgUpdate[]>(
          "getUpdates",
          {
            offset: this.config.offset ?? 0,
            timeout: POLL_TIMEOUT_SECONDS,
            allowed_updates: ["message"],
          },
          this.controller?.signal,
        );
        for (const update of updates) {
          if (typeof update.update_id === "number") {
            this.config.offset = update.update_id + 1;
            this.callbacks.onConfigDirty();
          }
          const message = update.message;
          if (!message || message.from?.is_bot) continue;
          this.handleMessage(message);
        }
      } catch (err) {
        if (!this.running) break;
        this.callbacks.onState("error", errorMessage(err));
        await delay(ERROR_BACKOFF_MS);
      }
    }
  }

  private handleMessage(message: TgMessage): void {
    const from = message.from;
    const sessionId = String(message.chat.id);
    this.callbacks.onMessage({
      sessionId,
      senderId: String(from?.id ?? message.chat.id),
      senderName: displayName(from, message.chat),
      text: (message.text ?? message.caption ?? "").trim(),
      kind: message.chat.type === "private" ? "private" : "group",
      media: this.collectMedia(message),
    });
  }

  private collectMedia(message: TgMessage): InboundMedia[] {
    const media: InboundMedia[] = [];
    const photo = message.photo?.[message.photo.length - 1];
    if (photo) {
      media.push(
        this.mediaFor(
          { file_id: photo.file_id },
          "image",
          `photo_${message.message_id}.jpg`,
        ),
      );
    }
    if (message.document) {
      media.push(
        this.mediaFor(message.document, "file", `file_${message.message_id}`),
      );
    }
    if (message.video) {
      media.push(
        this.mediaFor(
          message.video,
          "video",
          `video_${message.message_id}.mp4`,
        ),
      );
    }
    if (message.voice) {
      media.push(
        this.mediaFor(
          message.voice,
          "voice",
          `voice_${message.message_id}.ogg`,
        ),
      );
    }
    if (message.audio) {
      media.push(
        this.mediaFor(
          message.audio,
          "voice",
          `audio_${message.message_id}.mp3`,
        ),
      );
    }
    return media;
  }

  /** Media descriptor that downloads via `getFile` + the file endpoint. */
  private mediaFor(
    ref: TgFileRef,
    kind: InboundMedia["kind"],
    fallbackName: string,
  ): InboundMedia {
    const fileName = ref.file_name ?? fallbackName;
    const mime = ref.mime_type ?? mimeByFileName(fileName);
    return {
      kind,
      fileName,
      mime,
      save: async (targetDir) => {
        const file = await this.call<{ file_path?: string }>("getFile", {
          file_id: ref.file_id,
        });
        if (!file.file_path) return null;
        const url = `${API_BASE}/file/bot${this.config.botToken}/${file.file_path}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = Buffer.from(await res.arrayBuffer());
        const target = join(targetDir, safeFileName(fileName));
        await writeFile(target, data);
        return { path: target, size: data.length };
      },
    };
  }

  private async call<T>(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await fetch(this.url(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params ?? {}),
      ...(signal ? { signal } : {}),
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!json.ok)
      throw new Error(json.description ?? `Telegram ${method} failed`);
    return json.result as T;
  }

  private async callForm<T>(method: string, form: FormData): Promise<T> {
    const res = await fetch(this.url(method), { method: "POST", body: form });
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!json.ok)
      throw new Error(json.description ?? `Telegram ${method} failed`);
    return json.result as T;
  }

  private url(method: string): string {
    return `${API_BASE}/bot${this.config.botToken}/${method}`;
  }
}

function displayName(user: TgUser | undefined, chat: TgChat): string {
  if (user) {
    const name = [user.first_name, user.last_name]
      .filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      )
      .join(" ")
      .trim();
    if (name) return name;
    if (user.username) return `@${user.username}`;
    return String(user.id);
  }
  return chat.title ?? "Telegram";
}
