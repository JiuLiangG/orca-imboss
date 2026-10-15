import { getChat } from "../db/chats";
import { t } from "@shared/l10n";
import type { Message, MessageStep } from "@shared/types";

/**
 * Outbound formatting: app messages are forwarded to a platform as text.
 * Non-text kinds (`ask`, `progress`, `chat`) are expanded into a readable text
 * description, and Markdown is flattened (platforms render plain text at best).
 */

/**
 * Highest-priority helper: convert a message into its forwardable plain-text
 * body. Attachment filenames are deliberately excluded — the manager sends
 * files as native media and only falls back to a `[name]` note when a file
 * cannot be delivered, so successful sends are never duplicated as text.
 */
export function formatOutbound(message: Message): string {
  return markdownToPlainText(formatBody(message)).trim();
}

function formatBody(message: Message): string {
  switch (message.kind) {
    case "ask":
      return formatAsk(message.content);
    case "progress":
      return formatProgress(message.content, message.steps ?? []);
    case "chat":
      return formatChatLink(message.content);
    case "interrupted":
      return formatInterrupted(message.groupChatId);
    default:
      return message.content;
  }
}

/** `interrupted` carries the halted task group id in `groupChatId`. */
function formatInterrupted(groupChatId: number | null): string {
  if (groupChatId === null) {
    return t("The boss interrupted all sessions in this task group chat.");
  }
  const title = getChat(groupChatId)?.title.trim();
  return t(
    'The boss interrupted all sessions in the task group chat "${title}".',
    { title: title && title.length > 0 ? title : `#${groupChatId}` },
  );
}

/** `ask` content is a JSON question set. */
function formatAsk(content: string): string {
  try {
    const parsed = JSON.parse(content) as {
      questions?: Array<{ text?: unknown; options?: unknown }>;
    };
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    if (questions.length === 0) return content;
    const lines: string[] = [t("Question")];
    questions.forEach((question, index) => {
      const text = typeof question.text === "string" ? question.text : "";
      lines.push(`${index + 1}. ${text}`);
      const options = Array.isArray(question.options) ? question.options : [];
      for (const option of options) {
        if (typeof option === "string") lines.push(`   - ${option}`);
      }
    });
    return lines.join("\n");
  } catch {
    return content;
  }
}

/** `progress` content is the card title; `steps` is the step list. */
function formatProgress(title: string, steps: MessageStep[]): string {
  const lines: string[] = [title];
  for (const step of steps) {
    const role = step.role ? ` (${step.role})` : "";
    lines.push(`- ${step.name}${role} — ${step.status}`);
  }
  return lines.join("\n");
}

/** `chat` content is the linked chat id. */
function formatChatLink(content: string): string {
  const id = Number(content.trim());
  if (Number.isSafeInteger(id) && id > 0) {
    const chat = getChat(id);
    if (chat) {
      const title = chat.title.trim().length > 0 ? chat.title : t("New Chat");
      return t("New group chat: ${title}", { title });
    }
  }
  return t("New group chat");
}

/**
 * Lightweight Markdown → plain text (keeps newlines). Deliberately regex-based
 * and dependency-free: it runs on every forwarded message.
 */
export function markdownToPlainText(text: string): string {
  let result = text;
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) =>
    String(code).trim(),
  );
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner) =>
    String(inner)
      .split("|")
      .map((cell) => cell.trim())
      .join("  "),
  );
  result = result.replace(/(\*\*|__)(.*?)\1/g, "$2");
  result = result.replace(/(\*|_)(.*?)\1/g, "$2");
  result = result.replace(/~~(.*?)~~/g, "$1");
  result = result.replace(/^#{1,6}\s+/gm, "");
  result = result.replace(/^[>\s]*>/gm, "");
  result = result.replace(/`([^`]+)`/g, "$1");
  return result;
}

/**
 * Split text into platform-sized chunks without breaking surrogate pairs.
 * Prefers newline boundaries; falls back to a hard slice.
 */
export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength / 2) splitAt = maxLength;
    // Never split a surrogate pair (emoji / non-BMP characters).
    const code = remaining.charCodeAt(splitAt - 1);
    if (code >= 0xd800 && code <= 0xdbff) splitAt -= 1;
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
