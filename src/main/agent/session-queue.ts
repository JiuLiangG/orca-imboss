import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { ASSISTANT_ID } from "@shared/constants/employees";
import { readChatPrompt } from "@shared/constants/prompts";
import type { WebContents } from "electron";
import * as dbChats from "../db/chats";
import { errorEvent, sendEventTo, toStreamEvent } from "./agent-events";
import { getAgentEnvironment } from "./environment";
import type { AgentSession as AppAgentSession } from "./session";
import { ensureSessionFile } from "./session-files";

/**
 * App-level serialized queue per `{employeeId}/{chatId}`.
 *
 * This is the single serialization point for ALL agent runs. Unlike the old
 * per-message session, the app `AgentSession` wrapper is **persistent per
 * key**: one live Pi session is reused for every message in the queue and is
 * only rebuilt when its composition signature changes (the wrapper checks
 * that on every `prepare()`). It is disposed after a 5-minute idle period.
 *
 * Messages are plain text — no reply is captured or persisted; the agent
 * posts its own output through `imb_*` tools. A failed run is reported to the
 * windows bound to the key as an `error` event and never loses the caller's
 * already-persisted message.
 *
 * This module also owns the session bindings: a renderer window "binds" a
 * `(employee, chat)` key to receive that session's streamed events.
 */

const IDLE_MS = 5 * 60 * 1000;

interface QueueState {
  employeeId: number;
  chatId: number;
  /** App wrapper, persistent across queued messages until idle disposal. */
  session?: AppAgentSession;
  busy: boolean;
  /** Pending message texts, in arrival order. */
  queue: string[];
  idleTimer?: NodeJS.Timeout;
  /** Windows that bound this key (receive its streamed events). */
  boundSenders: Set<WebContents>;
  /** Set by lifecycle teardown so an in-flight drain stops cleanly. */
  disposed: boolean;
}

const states = new Map<string, QueueState>();

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
): Promise<void> {
  const state = getOrCreateState(employeeId, chatId);
  clearIdleTimer(state);
  state.queue.push(text);
  if (state.busy) return;
  state.busy = true;
  void drain(state);
}

/**
 * Wake an employee's session for a chat. The assistant deliberately has no
 * session in task group chats: it is woken in its root-chat session instead,
 * with a prompt that names the group chat to read.
 */
export async function wakeAgent(
  employeeId: number,
  chatId: number,
  fallbackText: string,
): Promise<void> {
  // Guard: a cron tick can race with chat deletion. If the chat is already
  // gone, drop the wake instead of materializing an orphan session for it.
  if (!dbChats.getChat(chatId)) return;
  let targetChatId = chatId;
  let text = fallbackText;
  if (employeeId === ASSISTANT_ID) {
    const rootId = dbChats.getRootChatId(chatId);
    if (rootId !== chatId) {
      targetChatId = rootId;
      text = readChatPrompt(chatId);
    }
  }
  await ensureSessionFile(employeeId, targetChatId);
  await deliver(employeeId, targetChatId, text);
}

/**
 * Register a renderer window to receive a key's streamed events.
 *
 * The agent session is NOT built here: it is created lazily by `deliver()`
 * (via `ensureSession`) on the first message. Selecting a chat is therefore
 * cheap, and a run already in flight (cron / other entries) is still observed
 * because events are forwarded to `boundSenders`, independent of whether this
 * call created the session.
 */
export function bind(
  employeeId: number,
  chatId: number,
  sender: WebContents,
): void {
  const state = getOrCreateState(employeeId, chatId);
  clearIdleTimer(state);
  if (state.boundSenders.has(sender)) return;
  state.boundSenders.add(sender);
  const onDestroyed = (): void => {
    sender.removeListener("destroyed", onDestroyed);
    unbind(employeeId, chatId, sender);
  };
  sender.once("destroyed", onDestroyed);
}

/** Remove a window's binding; drop the entry once fully idle. */
export function unbind(
  employeeId: number,
  chatId: number,
  sender: WebContents,
): void {
  const key = keyFor(employeeId, chatId);
  const state = states.get(key);
  if (!state) return;
  state.boundSenders.delete(sender);
  if (state.boundSenders.size > 0 || state.busy || state.disposed) return;
  if (state.session) {
    scheduleIdleDispose(state);
  } else if (state.queue.length === 0) {
    states.delete(key);
  }
}

/** Dispose every session for one chat (chat deleted). */
export async function disposeForChat(chatId: number): Promise<void> {
  await disposeMatching((state) => state.chatId === chatId);
}

/** Dispose every session for one employee (employee deleted). */
export async function disposeForEmployee(employeeId: number): Promise<void> {
  await disposeMatching((state) => state.employeeId === employeeId);
}

/** Dispose every session (app quit). */
export async function disposeAll(): Promise<void> {
  await disposeMatching(() => true);
}

async function drain(state: QueueState): Promise<void> {
  try {
    while (!state.disposed) {
      const text = state.queue.shift();
      if (text === undefined) break;
      try {
        await ensureSession(state);
        if (state.disposed) {
          await disposeSessionOf(state);
          break;
        }
        await state.session?.prompt(text);
      } catch (err) {
        emitError(state, err);
      }
    }
  } finally {
    state.busy = false;
    if (state.disposed) return;
    if (state.queue.length > 0) {
      state.busy = true;
      void drain(state);
    } else {
      scheduleIdleDispose(state);
    }
  }
}

/**
 * Ensure the wrapper exists and is prepared. The wrapper itself compares the
 * composition signature and rebuilds only when needed.
 */
async function ensureSession(state: QueueState): Promise<void> {
  if (state.disposed) {
    throw new Error("Agent session state has been disposed.");
  }
  // Persist the (employee, chat) session file before building the Pi session,
  // so even a root chat (assistant ↔ user) resumes from disk instead of
  // starting in-memory. Idempotent: a recorded row is a no-op.
  await ensureSessionFile(state.employeeId, state.chatId);
  if (!state.session) {
    // Lazy import avoids a module-load cycle (session.ts imports builtin-tools,
    // which imports this module).
    const { AgentSession } = await import("./session");
    const env = getAgentEnvironment();
    state.session = new AgentSession(
      env,
      { employeeId: state.employeeId, chatId: state.chatId },
      (event) => forwardEvent(state, event),
    );
  }
  await state.session.prepare();
}

async function disposeMatching(
  predicate: (state: QueueState) => boolean,
): Promise<void> {
  const matching = [...states.values()].filter(predicate);
  await Promise.all(matching.map((state) => disposeState(state, true)));
}

function getOrCreateState(employeeId: number, chatId: number): QueueState {
  const key = keyFor(employeeId, chatId);
  let state = states.get(key);
  if (!state) {
    state = {
      employeeId,
      chatId,
      busy: false,
      queue: [],
      boundSenders: new Set(),
      disposed: false,
    };
    states.set(key, state);
  }
  return state;
}

function keyFor(employeeId: number, chatId: number): string {
  return `${employeeId}/${chatId}`;
}

function clearIdleTimer(state: QueueState): void {
  if (state.idleTimer !== undefined) {
    clearTimeout(state.idleTimer);
    state.idleTimer = undefined;
  }
}

function scheduleIdleDispose(state: QueueState): void {
  if (state.disposed) return;
  clearIdleTimer(state);
  state.idleTimer = setTimeout(() => {
    state.idleTimer = undefined;
    void disposeState(state, false);
  }, IDLE_MS);
}

/**
 * Tear down the state's session. `forceRemove` marks the state disposed and
 * drops it from the registry (lifecycle teardown); otherwise the entry is
 * removed only when nothing is bound and the queue is empty.
 */
async function disposeState(
  state: QueueState,
  forceRemove: boolean,
): Promise<void> {
  clearIdleTimer(state);
  if (forceRemove) {
    state.disposed = true;
    states.delete(keyFor(state.employeeId, state.chatId));
  }

  await disposeSessionOf(state);

  if (state.disposed || state.busy) return;
  if (state.queue.length > 0) {
    state.busy = true;
    void drain(state);
    return;
  }
  if (state.boundSenders.size === 0) {
    states.delete(keyFor(state.employeeId, state.chatId));
  }
}

/** Dispose the wrapper (if any) and clear the reference; never throws. */
async function disposeSessionOf(state: QueueState): Promise<void> {
  const session = state.session;
  state.session = undefined;
  if (!session) return;
  try {
    await session.dispose();
  } catch (err) {
    console.error(
      `[session-queue] failed to dispose session for ${state.employeeId} in chat ${state.chatId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Forward a raw Pi event to this key's bound windows (whitelisted DTOs). */
function forwardEvent(state: QueueState, event: AgentSessionEvent): void {
  const dto = toStreamEvent(event);
  if (dto) {
    sendEventTo(state.boundSenders, state.employeeId, state.chatId, dto);
  }
}

/** Report a failed run to the bound windows and the log. */
function emitError(state: QueueState, err: unknown): void {
  console.error(
    `[session-queue] run for ${state.employeeId} in chat ${state.chatId} failed:`,
    err instanceof Error ? err.message : err,
  );
  sendEventTo(
    state.boundSenders,
    state.employeeId,
    state.chatId,
    errorEvent(err),
  );
}
