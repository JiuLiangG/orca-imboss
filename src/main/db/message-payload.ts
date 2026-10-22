import type {
  ImageGenStatus,
  MessageAttachment,
  MessageStep,
  StepStatus,
} from "@shared/types";
import { parseJsonObject } from "./json";

/**
 * Read helpers for the `messages` table's JSON payload columns (`steps`,
 * `attachments`, `image_status`).
 *
 * Extracted from the message store so the chat-summary query can read the same
 * payloads the same way without importing the whole store (which would create
 * an import cycle). Stored values are never trusted: every parser validates
 * field by field, drops what it cannot understand, and never throws.
 */

/** Step statuses a stored step may carry, in progress order. */
export const STEP_STATUSES: readonly StepStatus[] = ["done", "busy", "pending"];

/** Sanity cap for a stored attachment path (mirrors the write-side limit). */
export const MAX_ATTACH_PATH_LENGTH = 4096;

/** Lifecycle values a stored `image_status` may carry. */
const IMAGE_STATUSES: readonly ImageGenStatus[] = [
  "generating",
  "done",
  "error",
];

/**
 * Read the optional linked group chat id stored alongside the step list.
 * Stored values are never trusted: only a safe positive integer surfaces,
 * anything else (including absence) becomes `null`.
 */
export function parseGroupChatId(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  const id = parsed["chatId"];
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

export function parseSteps(raw: string | null): MessageStep[] | null {
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  const steps = parsed["steps"];
  if (!Array.isArray(steps)) return null;
  const result: MessageStep[] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) continue;
    const record = step as Record<string, unknown>;
    // `task` superseded the old `role` field. Cards published before the rename
    // still carry the employee's role there, so fall back to it on read — the
    // write path (`validateSteps`) only ever produces `task`.
    const task = record["task"] ?? record["role"];
    if (
      typeof record["name"] !== "string" ||
      typeof task !== "string" ||
      !STEP_STATUSES.includes(record["status"] as StepStatus)
    ) {
      continue;
    }
    result.push({
      name: record["name"],
      task,
      status: record["status"] as StepStatus,
      employeeId:
        typeof record["employeeId"] === "number" &&
        Number.isSafeInteger(record["employeeId"]) &&
        record["employeeId"] >= 0
          ? record["employeeId"]
          : null,
    });
  }
  return result;
}

/**
 * Parse a stored attachments JSON. Stored values are never trusted: entries
 * are validated field by field and invalid ones dropped; `null` is stored as
 * null and only ever surfaces as `[]` when the column held a valid array.
 */
export function parseAttachments(
  raw: string | null,
): MessageAttachment[] | null {
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  const list = parsed["attachments"];
  if (!Array.isArray(list)) return null;
  const result: MessageAttachment[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record["name"] !== "string" || record["name"].length === 0) {
      continue;
    }
    const path = record["path"];
    const kind = record["kind"];
    const chatId = record["chatId"];
    const parsedKind =
      kind === "file" || kind === "folder" || kind === "chat"
        ? kind
        : undefined;
    result.push({
      name: record["name"],
      size: typeof record["size"] === "number" ? record["size"] : 0,
      type: typeof record["type"] === "string" ? record["type"] : "",
      ...(typeof path === "string" &&
      path.length > 0 &&
      path.length <= MAX_ATTACH_PATH_LENGTH
        ? { path }
        : {}),
      ...(parsedKind ? { kind: parsedKind } : {}),
      ...(parsedKind === "chat" &&
      typeof chatId === "number" &&
      Number.isSafeInteger(chatId) &&
      chatId > 0
        ? { chatId }
        : {}),
    });
  }
  return result;
}

/**
 * Read the optional true attachment `total` stored alongside an attachments
 * payload. Returns `null` when absent or invalid; the caller falls back to the
 * number of rows actually stored.
 */
export function parseAttachmentTotal(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  const total = parsed["total"];
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
    return null;
  }
  return total;
}

/** Coerce a stored `image_status` to a known lifecycle value, else `null`. */
export function parseImageStatus(raw: string | null): ImageGenStatus | null {
  if (!raw) return null;
  return IMAGE_STATUSES.includes(raw as ImageGenStatus)
    ? (raw as ImageGenStatus)
    : null;
}
