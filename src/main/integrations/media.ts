import { mkdir, rm } from "fs/promises";
import { basename, extname, join } from "path";
import { INTEGRATION_PLATFORMS } from "@shared/constants/integrations";
import type { IntegrationPlatform, MessageAttachment } from "@shared/types";
import { getIntegrationsMediaDir } from "../data-dir";
import type { InboundMedia } from "./types";

/**
 * Inbound platform media storage: `<dataRoot>/integrations/media/<platform>/
 * <chatId>/<file>`. Files are downloaded lazily (after the sender passes the
 * owner check) and removed when the owning chat is deleted.
 */

/** Sanitize an untrusted filename (no path separators / traversal). */
export function safeFileName(name: string): string {
  const base = basename(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  const trimmed = base.trim();
  if (trimmed.length === 0 || trimmed === "." || trimmed === "..") {
    return "file";
  }
  return trimmed.slice(0, 200);
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
  txt: "text/plain",
  zip: "application/zip",
  gz: "application/gzip",
  json: "application/json",
};

/** Best-effort MIME type from a filename extension. */
export function mimeByFileName(name: string): string {
  const ext = extname(name).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Directory holding one chat's downloaded media. */
export function chatMediaDir(
  platform: IntegrationPlatform,
  chatId: number,
): string {
  return join(getIntegrationsMediaDir(), platform, String(chatId));
}

/** Download and attach all inbound media; failures degrade to no attachment. */
export async function saveInboundMedia(
  platform: IntegrationPlatform,
  chatId: number,
  media: InboundMedia[],
): Promise<MessageAttachment[]> {
  if (media.length === 0) return [];
  const dir = chatMediaDir(platform, chatId);
  await mkdir(dir, { recursive: true });
  const attachments: MessageAttachment[] = [];
  for (const item of media) {
    try {
      const saved = await item.save(dir);
      if (!saved) continue;
      attachments.push({
        name: item.fileName,
        size: saved.size,
        type: item.mime,
        path: saved.path,
      });
    } catch (err) {
      console.error(
        "[integrations] failed to download inbound media:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return attachments;
}

/**
 * Delete every platform's media directory for a chat. Called from `chats:delete`
 * (the platform subdir is unknown there, so all are attempted).
 */
export async function deleteMediaForChat(chatId: number): Promise<void> {
  const root = getIntegrationsMediaDir();
  await Promise.all(
    INTEGRATION_PLATFORMS.map((platform) =>
      rm(join(root, platform, String(chatId)), {
        recursive: true,
        force: true,
      }).catch(() => undefined),
    ),
  );
}
