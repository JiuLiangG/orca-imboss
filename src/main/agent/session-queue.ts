import * as messagesService from "../db/services/messages";
import { broadcast } from "../notifications";
import { getAgentEnvironment, type AgentEnvironment } from "./environment";

/**
 * App-level serialized queue per `{employeeId}/{chatId}`.
 *
 * This is the single serialization point for ALL agent runs: a session that is
 * already processing a previous message queues the new one instead of running
 * concurrently (which would race on the same per-(employee, chat) Pi session
 * file). Each queued run builds a *fresh* resumed `AgentSession`, so config
 * edits (model / MCP / system prompt) apply on the next run.
 *
 * A failed run is logged and swallowed — it never loses the user's message
 * (the caller's own persistence already happened before `deliver` was called).
 */

export interface DeliverOptions {
  /**
   * When set, persist the agent's reply as a message from this employee
   * (`messages.appendMessage(chatId, replyAs, replyText)`). `null` disables
   * auto-persist (the agent is expected to post via `send_message` itself).
   */
  persistReplyAs?: number | null;
  /** Fallback reply text persisted when the run does not produce a reply. */
  fallbackReply?: string | null;
}

interface QueueItem {
  text: string;
  opts: DeliverOptions;
}

interface QueueState {
  employeeId: number;
  chatId: number;
  busy: boolean;
  queue: QueueItem[];
}

const states = new Map<string, QueueState>();

function keyFor(employeeId: number, chatId: number): string {
  return `${employeeId}/${chatId}`;
}

/**
 * Schedule a message for an agent session, serialized per (employee, chat).
 *
 * Returns immediately (fire-and-forget): if a run for the key is already in
 * flight the message is queued, otherwise a run is started and the queue is
 * drained in order.
 */
export async function deliver(
  employeeId: number,
  chatId: number,
  text: string,
  opts: DeliverOptions = {},
): Promise<void> {
  const key = keyFor(employeeId, chatId);
  let state = states.get(key);
  if (!state) {
    state = { employeeId, chatId, busy: false, queue: [] };
    states.set(key, state);
  }
  state.queue.push({ text, opts });
  if (state.busy) return;
  state.busy = true;
  void drain(state);
}

async function drain(state: QueueState): Promise<void> {
  try {
    // Lazy import avoids a module-load cycle (session.ts imports builtin-tools).
    const { AgentSession } = await import("./session");
    const env: AgentEnvironment = getAgentEnvironment();

    while (state.queue.length > 0) {
      const item = state.queue.shift() as QueueItem;
      const session = new AgentSession(env, {
        employeeId: state.employeeId,
        chatId: state.chatId,
      });
      try {
        const result = await session.prompt(item.text);
        if (item.opts.persistReplyAs != null) {
          const reply =
            result.replied && result.replyText && result.replyText.length > 0
              ? result.replyText
              : (item.opts.fallbackReply ?? null);
          if (reply)
            persistReply(state.chatId, item.opts.persistReplyAs, reply);
        }
      } catch (err) {
        console.error(
          `[session-queue] run for ${state.employeeId} in chat ${state.chatId} failed:`,
          err instanceof Error ? err.message : err,
        );
        if (item.opts.persistReplyAs != null && item.opts.fallbackReply) {
          persistReply(
            state.chatId,
            item.opts.persistReplyAs,
            item.opts.fallbackReply,
          );
        }
      } finally {
        // Dispose must never throw: an exception here would otherwise leave
        // `busy` set permanently and stall the queue for this (employee, chat).
        try {
          await session.dispose();
        } catch {
          // Ignore a dispose failure; the queue must keep draining.
        }
      }
    }
  } finally {
    state.busy = false;
  }
}

/** Best-effort reply persistence; a failure must never stall the queue. */
function persistReply(
  chatId: number,
  senderEmployeeId: number,
  reply: string,
): void {
  try {
    messagesService.appendMessage(chatId, senderEmployeeId, reply);
    // Tell the renderer that this chat's thread changed (cron/user reply).
    broadcast("messages:changed", chatId);
  } catch (err) {
    console.error(
      `[session-queue] failed to persist reply in chat ${chatId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
