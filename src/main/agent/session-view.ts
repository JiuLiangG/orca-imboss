import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentSessionViewEntry } from "@shared/types";
import { resolve } from "path";
import { getAgentSessionsDir } from "../data-dir";
import { getSession } from "../db/sessions";
import { loadPiSdk } from "./pi-sdk";
import { formatToolArgsDetail, summarizeToolArgs } from "./tool-args";

/**
 * Project a persisted `(employee, chat)` Pi session into the slim, serializable
 * block list the read-only session view renders.
 *
 * Deliberately lossy: system messages, tool results, images and usage data
 * never leave the main process. User prompts, assistant text and thinking, tool
 * names with a capped argument summary/detail, and compaction summaries are
 * returned. Runs are linear in this app, so raw append order is the transcript
 * order (`getEntries()`).
 */

/** Upper bound for a single text/thinking/summary block (defensive). */
const MAX_TEXT = 32_000;

/** Read + project the session for `(employeeId, chatId)`. Never throws. */
export async function readSessionView(
  employeeId: number,
  chatId: number,
): Promise<AgentSessionViewEntry[]> {
  const record = getSession(employeeId, chatId);
  if (!record || !isInsideSessionsDir(record.session)) return [];

  let entries: SessionEntry[];
  try {
    const pi = await loadPiSdk();
    const manager = pi.SessionManager.open(
      record.session,
      getAgentSessionsDir(),
    );
    entries = manager.getEntries();
  } catch (err) {
    // A missing/corrupt/zero-byte session file must degrade to an empty view,
    // never break the renderer request.
    console.error(
      `[session-view] failed to read session for ${employeeId} in chat ${chatId}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
  return projectEntries(entries);
}

/** Map raw session entries to the renderer DTO list. */
function projectEntries(entries: SessionEntry[]): AgentSessionViewEntry[] {
  const out: AgentSessionViewEntry[] = [];
  // toolCallId -> index in `out`, so a later toolResult can resolve its status.
  const toolIndex = new Map<string, number>();

  for (const entry of entries) {
    if (entry.type === "compaction") {
      const summary = cap(entry.summary);
      if (summary.length > 0) {
        out.push({ kind: "compaction", id: entry.id, summary });
      }
      continue;
    }
    if (entry.type !== "message") continue;

    const message = entry.message as {
      role?: unknown;
      content?: unknown;
      toolCallId?: unknown;
      isError?: unknown;
    };
    switch (message.role) {
      case "user": {
        const text = extractUserText(message.content);
        if (text.length > 0) {
          out.push({ kind: "user", id: entry.id, text: cap(text) });
        }
        break;
      }
      case "assistant":
        projectAssistant(entry.id, message.content, out, toolIndex);
        break;
      case "toolResult":
        applyToolResult(out, toolIndex, message.toolCallId, message.isError);
        break;
      default:
        // System messages (prompt + tool declarations) are intentionally hidden.
        break;
    }
  }
  return out;
}

/** Append one block per assistant content block, preserving order. */
function projectAssistant(
  entryId: string,
  content: unknown,
  out: AgentSessionViewEntry[],
  toolIndex: Map<string, number>,
): void {
  if (typeof content === "string") {
    if (content.length > 0) {
      out.push({ kind: "text", id: entryId, text: cap(content) });
    }
    return;
  }
  if (!Array.isArray(content)) return;

  content.forEach((block, index) => {
    if (block === null || typeof block !== "object") return;
    const b = block as {
      type?: unknown;
      text?: unknown;
      thinking?: unknown;
      id?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
      out.push({ kind: "text", id: `${entryId}:t${index}`, text: cap(b.text) });
      return;
    }
    if (
      b.type === "thinking" &&
      typeof b.thinking === "string" &&
      b.thinking.length > 0
    ) {
      out.push({
        kind: "thinking",
        id: `${entryId}:k${index}`,
        text: cap(b.thinking),
      });
      return;
    }
    if (b.type === "toolCall" && typeof b.name === "string") {
      const toolCallId = typeof b.id === "string" ? b.id : undefined;
      toolIndex.set(toolCallId ?? `${entryId}:c${index}`, out.length);
      const tool: Extract<AgentSessionViewEntry, { kind: "tool" }> = {
        kind: "tool",
        id: `${entryId}:c${index}`,
        ...(toolCallId !== undefined ? { toolCallId } : {}),
        name: b.name,
        argsSummary: summarizeToolArgs(b.name, b.arguments),
        // Flipped to ok/error when the matching toolResult is reached; a
        // session read mid-run legitimately leaves it "running".
        status: "running",
      };
      const detail = formatToolArgsDetail(b.arguments);
      if (detail !== undefined) tool.argsDetail = detail;
      out.push(tool);
    }
  });
}

/** Resolve a persisted toolResult against its tool block. */
function applyToolResult(
  out: AgentSessionViewEntry[],
  toolIndex: Map<string, number>,
  toolCallId: unknown,
  isError: unknown,
): void {
  if (typeof toolCallId !== "string") return;
  const index = toolIndex.get(toolCallId);
  if (index === undefined) return;
  const tool = out[index];
  if (tool.kind !== "tool") return;
  tool.status = isError === true ? "error" : "ok";
}

/** Flatten a user message's content to plain text (text blocks only). */
function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

/** Cap a block's text so one huge message can never blow up the payload. */
function cap(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…` : text;
}

/**
 * Security: only read files recorded inside `~/.imboss/agent/sessions`.
 * Mirrors the guard used by `db/sessions.ts` for unlinking.
 */
function isInsideSessionsDir(filePath: string): boolean {
  const norm = (p: string): string =>
    process.platform === "win32" ? p.toLowerCase() : p;
  const root = norm(resolve(getAgentSessionsDir()));
  const target = norm(resolve(filePath));
  return (
    target === root ||
    target.startsWith(root + "/") ||
    target.startsWith(root + "\\")
  );
}
