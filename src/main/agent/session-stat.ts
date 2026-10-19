import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type {
  AgentMessageStat,
  AgentProgressKind,
  AgentProgressStat,
  EmployeeAgentStat,
} from "@shared/types";
import { extractTextContent, readSessionEntries } from "./session-view";

/**
 * "What is this agent doing right now?" — the data source behind the
 * assistant-only `imb_get_employee_stat` tool.
 *
 * Kept separate from `session-view.ts` on purpose: this module answers a status
 * question cheaply (one backwards scan for the last assistant message + the
 * live run state), while the view projects the whole transcript for rendering.
 * It reads **only** the persisted Pi session through the shared, guarded
 * `readSessionEntries` (unknown pair, corrupt/missing file and paths outside the
 * session store all degrade to "nothing persisted"), and it never touches live
 * Pi state itself — the in-flight half is passed in by the caller
 * (`session-queue.readSessionActivity`), so there is no import cycle between the
 * queue and this module.
 *
 * ## What counts as "the last agent message"
 *
 * Only assistant messages, and only their **text blocks** (thinking is dropped:
 * it is bulky and unrelated to "is it progressing") plus the **names** of their
 * tool calls (arguments may hold secrets and are capped elsewhere anyway). A
 * message that emits neither (e.g. an aborted empty turn) is skipped, so the
 * answer always points at something the model actually produced. `getEntries()`
 * order is the transcript order — runs are linear in this app, exactly like the
 * view's projection — so the scan simply walks backwards.
 */

/** One assistant message reduced to what a status probe needs. */
export interface LastAgentMessage {
  /** Text blocks joined with a newline (never capped here; see the caller). */
  text: string;
  /** Tool-call names in this message, in call order (identity only). */
  toolCalls: string[];
  /** ISO timestamp of the persisted entry. */
  at: string;
}

/**
 * Upper bound for the reported tool names of one message (defensive): a single
 * runaway message must not turn a status probe into a long payload.
 */
const MAX_TOOL_NAMES = 32;

/** Names of the tool calls inside one message's `content`, in call order. */
export function toolCallNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const block of content) {
    if (names.length >= MAX_TOOL_NAMES) break;
    if (block === null || typeof block !== "object") continue;
    const b = block as { type?: unknown; name?: unknown };
    if (b.type === "toolCall" && typeof b.name === "string" && b.name) {
      names.push(b.name);
    }
  }
  return names;
}

/**
 * The last assistant message of a persisted session, or `null` when the session
 * has no assistant output yet (or nothing is persisted at all).
 *
 * Never throws: `readSessionEntries` already swallows read failures, and every
 * malformed entry is skipped rather than parsed optimistically.
 */
export async function readLastAssistantMessage(
  employeeId: number,
  chatId: number,
): Promise<LastAgentMessage | null> {
  try {
    const entries = await readSessionEntries(employeeId, chatId);
    return findLastAssistantMessage(entries);
  } catch (err) {
    // A status probe must never fail because a transcript was surprising.
    console.error(
      `[session-stat] failed to find the last agent message of ${employeeId} in chat ${chatId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Pure half of `readLastAssistantMessage`, for reuse and clarity. */
function findLastAssistantMessage(
  entries: readonly SessionEntry[],
): LastAgentMessage | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type !== "message") continue;
    const message = entry.message as { role?: unknown; content?: unknown };
    if (message?.role !== "assistant") continue;
    const text = extractTextContent(message.content);
    const toolCalls = toolCallNames(message.content);
    // Skip turns that produced nothing readable: an empty/aborted assistant
    // message must never mask the model's actual last output.
    if (text.length === 0 && toolCalls.length === 0) continue;
    return { text, toolCalls, at: entry.timestamp };
  }
  return null;
}

/** What the caller measured live, before the two halves are merged. */
export interface LiveAgentOutput {
  /** Partial text of the in-flight assistant message. */
  text: string;
  /** Tool calls already emitted by the in-flight assistant message. */
  toolCalls: string[];
}

/** A tool call of the run in flight, as recorded from its start event. */
export interface OpenToolCall {
  name: string;
  /** Raw arguments of the call (formatted/truncated only when reported). */
  args: unknown;
  /** Wall-clock ms when `tool_execution_start` reached the app. */
  startedAt: number;
}

/** Time information about the run in flight, measured live. */
export interface LiveProgress {
  /** Wall-clock ms when the current run started. */
  runStartedAt: number;
  /** Wall-clock ms of the last observable progress. */
  lastProgressAt: number;
  lastProgressKind: AgentProgressKind;
  /** Tool calls that have not finished yet, keyed by tool-call id. */
  openTools: ReadonlyMap<string, OpenToolCall>;
  /** Tool calls started in this run. */
  toolCallsThisRun: number;
}

/** Live run state of one session, as `session-queue.readSessionActivity` sees it. */
export interface AgentSessionActivity {
  /** A Pi run is streaming right now. */
  streaming: boolean;
  /** Prompts waiting in the app-level queue (informational only). */
  queued: number;
  /**
   * The in-flight assistant message, when it has produced anything readable
   * yet. Absent while the run is between turns (e.g. a tool is executing) or
   * before the first token.
   */
  live?: LiveAgentOutput;
  /**
   * Timing of the run in flight. Absent when nothing is running or the run was
   * not observed from its start (the app never invents a start time).
   */
  progress?: LiveProgress;
}

/**
 * Character budget for the reported `activeTool.args`.
 *
 * The boss needs to see *what* an employee is stuck on (which URL, which
 * command), but the arguments are the model's own input and can be arbitrarily
 * long — so they are serialized to one line and cut here. Reporters must treat
 * the result as a hint, never as the complete call (see `argsTruncated`).
 */
const MAX_ACTIVE_TOOL_ARGS_CHARS = 1000;

/**
 * Serialize one tool call's arguments for the stat, single-line and capped.
 *
 * Defensive by design: unserializable arguments (cycles, functions) and missing
 * arguments both degrade to `args: null` instead of throwing, and a cut string
 * always sets `argsTruncated` so a caller never mistakes it for the whole call.
 */
export function formatActiveToolArgs(args: unknown): {
  args: string | null;
  argsTruncated: boolean;
} {
  if (args === undefined || args === null) {
    return { args: null, argsTruncated: false };
  }
  let json: unknown;
  try {
    json = JSON.stringify(args);
  } catch {
    return { args: null, argsTruncated: false };
  }
  if (typeof json !== "string") return { args: null, argsTruncated: false };
  if (json.length <= MAX_ACTIVE_TOOL_ARGS_CHARS) {
    return { args: json, argsTruncated: false };
  }
  return {
    args: json.slice(0, MAX_ACTIVE_TOOL_ARGS_CHARS),
    argsTruncated: true,
  };
}

/** Everything the stat is built from, already measured by the caller. */
export interface EmployeeAgentStatInput {
  employeeId: number;
  chatId: number;
  chatTitle: string;
  /** A persisted session exists for this pair. */
  sessionExists: boolean;
  activity: AgentSessionActivity;
  /** Last persisted assistant message, or `null` when there is none. */
  persisted: LastAgentMessage | null;
  /** Cap for the reported `text` (defensive: the model asks, we bound). */
  maxChars: number;
}

/**
 * Merge the live and persisted halves into the tool payload.
 *
 * The boss's requirement is that this reflects what the employee is doing
 * **now**, so a running session never reports a finished message as "the last
 * agent message": while `running`, `lastAgentMessage` always describes the
 * **current turn** (`streaming: true`) — its live partial output, or an empty
 * one when that turn has produced nothing readable yet (between turns while a
 * tool executes, or before the first token). The last persisted message is then
 * only offered as `previousAgentMessage` for comparison. `queued` never
 * participates: a pending prompt is future work, not the current state.
 *
 * When the session is not running, the answer is the transcript's last
 * assistant message (`streaming: false`) or `null` when it never produced one.
 */
export function buildEmployeeAgentStat(
  input: EmployeeAgentStatInput,
): EmployeeAgentStat {
  const { activity, persisted, maxChars } = input;
  const now = Date.now();

  const stat: EmployeeAgentStat = {
    employeeId: input.employeeId,
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    sessionExists: input.sessionExists,
    running: activity.streaming,
    queued: activity.queued,
    lastAgentMessage: null,
  };

  if (activity.streaming) {
    // Never fall back to the persisted message here: it is history, not what
    // the employee is producing now (the caller keeps it in
    // `previousAgentMessage`).
    stat.lastAgentMessage = toMessageStat(
      activity.live?.text ?? "",
      activity.live?.toolCalls ?? [],
      null,
      true,
      maxChars,
      now,
    );
    if (persisted) {
      stat.previousAgentMessage = toMessageStat(
        persisted.text,
        persisted.toolCalls,
        persisted.at,
        false,
        maxChars,
        now,
      );
    }
    if (activity.progress) {
      stat.progress = toProgressStat(activity.progress, now);
    }
    return stat;
  }

  if (persisted) {
    stat.lastAgentMessage = toMessageStat(
      persisted.text,
      persisted.toolCalls,
      persisted.at,
      false,
      maxChars,
      now,
    );
  }
  return stat;
}

/**
 * Reduce one message to its reported form: cap the text, count the full length,
 * and compute the age main-side so the model does not have to know the clock.
 * A missing/unparsable timestamp degrades to `ageSeconds: null` rather than a
 * bogus number.
 */
function toMessageStat(
  text: string,
  toolCalls: string[],
  at: string | null,
  streaming: boolean,
  maxChars: number,
  now: number,
): AgentMessageStat {
  const chars = text.length;
  const truncated = chars > maxChars;
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    chars,
    truncated,
    toolCalls,
    streaming,
    at,
    ageSeconds: at === null ? null : ageInSeconds(at, now),
  };
}

/**
 * Reduce the live timing of the run in flight: ages main-side, and the oldest
 * still-open tool call (the run cannot advance past it) with its capped
 * arguments.
 *
 * `lastProgressAgeSeconds` is never older than `runAgeSeconds` (a run with no
 * observed activity yet reports its start as the progress point).
 */
function toProgressStat(
  progress: LiveProgress,
  now: number,
): AgentProgressStat {
  const stat: AgentProgressStat = {
    runAgeSeconds: secondsSince(progress.runStartedAt, now),
    lastProgressAgeSeconds: secondsSince(progress.lastProgressAt, now),
    lastProgressKind: progress.lastProgressKind,
    toolCallsThisRun: progress.toolCallsThisRun,
  };
  const active = oldestOpenTool(progress.openTools);
  if (active) {
    const { args, argsTruncated } = formatActiveToolArgs(active.args);
    stat.activeTool = {
      name: active.name,
      ageSeconds: secondsSince(active.startedAt, now),
      args,
      argsTruncated,
    };
  }
  return stat;
}

/** The tool call that has been running the longest, if any is open. */
function oldestOpenTool(
  openTools: ReadonlyMap<string, OpenToolCall>,
): OpenToolCall | undefined {
  let oldest: OpenToolCall | undefined;
  for (const tool of openTools.values()) {
    if (!oldest || tool.startedAt < oldest.startedAt) oldest = tool;
  }
  return oldest;
}

/** Whole seconds since a wall-clock ms timestamp (never negative). */
function secondsSince(at: number, now: number): number {
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.round((now - at) / 1000));
}

/** Whole seconds since an ISO timestamp; `null` when it cannot be parsed. */
function ageInSeconds(at: string, now: number): number | null {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((now - parsed) / 1000));
}
