import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { mkdir, stat, writeFile } from "fs/promises";
import { homedir } from "os";
import { basename, dirname, extname, join } from "path";
import { Type } from "typebox";
import type {
  EmployeeSession,
  Message,
  MessageAttachment,
} from "../../shared/types";
import { getAgentSessionsDir } from "../data-dir";
import { getDB } from "../db";
import * as cron from "../cron";
import * as chatsService from "../db/services/chats";
import { parseCronJobId } from "../db/services/cron";
import * as employeesService from "../db/services/employees";
import * as messagesService from "../db/services/messages";
import * as sessionsService from "../db/services/sessions";
import { notifyUnread } from "../notifications";
import type { AgentEnvironment } from "./environment";
import type { AnyPiTool } from "./mcp";
import { loadPiSdk } from "./pi-sdk";
import { deliver } from "./session-queue";
const ASSISTANT_ID = employeesService.ASSISTANT_ID;
const getEmployee = employeesService.getEmployee;

/**
 * Imboss built-in team tools.
 *
 * LLM-callable tools that let the assistant orchestrate a team (create/edit
 * employees, create chats, send messages, schedule cron jobs, notify) and let
 * participant agents work inside chats. Backed by a persistent per-(employee,
 * chat) Pi session with a read cursor.
 *
 * The tool set is role-based: the assistant (employee id 0) gets every
 * orchestration tool (`set_employees`, `create_chat`, `send_message`,
 * `read_chat`, `list_employees`, `notify`, `set_cronjob`, `remove_cronjob`); a
 * participant employee gets only `send_message` and `read_chat`. All agent runs
 * are serialized per (employee, chat) via the session queue. `createTeamToolDefinitions`
 * captures the calling agent's identity so `read_chat` knows who is reading and
 * internal sends know who is sending.
 */

export interface TeamToolOptions {
  env: AgentEnvironment;
  employeeId: number;
  chatId: number;
}

/** Path of a persistent per-(employee, chat) Pi session file. */
function sessionPathFor(chatId: number, employeeId: number): string {
  return join(
    getAgentSessionsDir(),
    "chats",
    String(chatId),
    `${employeeId}.jsonl`,
  );
}

/**
 * Materialize an empty Pi session file at `path` so it can be resumed later.
 *
 * `SessionManager.open` on a zero-byte file immediately writes a valid session
 * header, which is exactly the deterministic file we want on disk from the
 * start. Best-effort: a materialization failure is logged and never thrown, so
 * a file problem can never roll back a committed DB transaction.
 */
async function materializeSessionFile(path: string): Promise<void> {
  const pi = await loadPiSdk();
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path, "", { flag: "wx" });
  } catch {
    // File already exists (valid or empty) — opening below handles it.
  }
  try {
    // Empty file => open writes a valid header; existing session => loads.
    pi.SessionManager.open(path, dir, homedir());
  } catch (err) {
    console.error(
      `[builtin-tools] Failed to materialize session ${path}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Ensure a session row exists for (employee, chat), creating row + file if not. */
async function ensureSession(
  employeeId: number,
  chatId: number,
): Promise<void> {
  if (sessionsService.getSession(employeeId, chatId)) return;
  const path = sessionPathFor(chatId, employeeId);
  try {
    await materializeSessionFile(path);
  } catch (err) {
    console.error(
      `[builtin-tools] Failed to materialize session for ${employeeId} in chat ${chatId}:`,
      err instanceof Error ? err.message : err,
    );
  }
  // Record the row even when the file write failed: a later resume re-opens
  // (and re-creates the header) from the empty file.
  sessionsService.setSession(employeeId, chatId, path);
}

/**
 * Fire-and-forget a participant's agent turn, serialized per (employee, chat)
 * by the session queue. The sub-agent mirrors the normal per-(employee, chat)
 * session (resumed from its own file) and is told to act on a new signal (read
 * a chat, process a prompt). No auto-persist here — the participant posts its
 * reply via `send_message` itself. Failures are logged and never propagated
 * back to the tool that scheduled the run.
 */
function fireAndForgetPrompt(
  _env: AgentEnvironment,
  employeeId: number,
  chatId: number,
  text: string,
): void {
  void deliver(employeeId, chatId, text);
}

/** Default signal sent to a participant whose chat was just written to. */
const READ_CHAT_PROMPT =
  "You have new messages in this chat. Call read_chat to read the latest messages and respond as appropriate.";

// ---------------------------------------------------------------------------
// shared internals
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  zip: "application/zip",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeByExtension(path: string): string {
  const ext = extname(path).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Resolve file paths → attachment metadata (name/size/type); no previews. */
async function resolveAttachments(
  paths: string[] | undefined,
): Promise<MessageAttachment[] | undefined> {
  if (!paths || paths.length === 0) return undefined;
  if (paths.length > 16) throw new Error("Too many attachments.");
  const result: MessageAttachment[] = [];
  for (const path of paths) {
    let stats;
    try {
      stats = await stat(path);
    } catch {
      throw new Error(`Attachment file not found: ${path}`);
    }
    if (!stats.isFile()) throw new Error(`Attachment is not a file: ${path}`);
    if (stats.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment is too large.");
    }
    result.push({
      name: basename(path),
      size: stats.size,
      type: mimeByExtension(path),
    });
  }
  return result;
}

/**
 * Shared send pipeline used by the `send_message` tool and by internal sends
 * (`create_chat.card`, `add_participant.join_notice`).
 *
 * The tool enforces that the sender is an active non-disabled participant of
 * the chat; internal sends pass `skipSenderCheck` so the orchestrating
 * assistant can post without being a participant of the target chat.
 */
async function performSendMessage(
  env: AgentEnvironment,
  input: {
    senderEmployeeId: number;
    chatId: number;
    kind?: string;
    content: string;
    attachments?: string[];
    notify?: number[];
    notifyPrompt?: string;
    skipSenderCheck?: boolean;
  },
): Promise<Message> {
  const chat = chatsService.getChat(input.chatId);
  if (!chat) throw new Error("Chat does not exist.");
  if (
    !input.skipSenderCheck &&
    !chat.participants.includes(input.senderEmployeeId)
  ) {
    throw new Error("Sender is not a participant of this chat.");
  }
  const sender = employeesService.getEmployee(input.senderEmployeeId);
  if (!sender || sender.disabled) {
    throw new Error("Sender is not an active employee.");
  }
  const attachments = await resolveAttachments(input.attachments);
  const message = messagesService.appendMessage(
    input.chatId,
    input.senderEmployeeId,
    input.content,
    {
      kind: input.kind ?? "text",
      attachments,
    },
  );

  for (const pid of input.notify ?? []) {
    if (!chat.participants.includes(pid)) continue;
    const target = employeesService.getEmployee(pid);
    if (!target || target.disabled) continue;
    await ensureSession(pid, input.chatId);
    fireAndForgetPrompt(
      env,
      pid,
      input.chatId,
      input.notifyPrompt ?? READ_CHAT_PROMPT,
    );
  }
  return message;
}

/** Wrap a tool payload as a Pi text tool result. */
function toolResult(value: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: { result: value },
  };
}

/** Validate an employee id is an active (non-disabled) employee. */
function assertActiveEmployee(employeeId: number): void {
  const employee = getEmployee(employeeId);
  if (!employee || employee.disabled) {
    throw new Error(`Employee ${employeeId} is not an active employee.`);
  }
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

/** `set_employees` — batch create (omit `id`) or update (pass `id`) employees. */
const setEmployeesTool: AnyPiTool = {
  name: "set_employees",
  label: "Set employees",
  description:
    "Batch create or update employees (name, role, system prompt, linked MCP servers, skills, model). " +
    "Each item omits `id` to create a new employee or passes `id` to update an existing one. " +
    "Returns the array of employee ids created or updated.",
  promptSnippet: "set_employees (batch create/edit employees)",
  parameters: Type.Object({
    employees: Type.Array(
      Type.Object({
        id: Type.Optional(Type.Integer({ minimum: 1 })),
        name: Type.Optional(Type.String({ maxLength: 200 })),
        role: Type.Optional(Type.String({ maxLength: 200 })),
        systemPrompt: Type.Optional(Type.String({ maxLength: 100000 })),
        mcp: Type.Optional(
          Type.Array(Type.String({ maxLength: 256 }), { maxItems: 256 }),
        ),
        skills: Type.Optional(
          Type.Array(Type.String({ maxLength: 256 }), { maxItems: 256 }),
        ),
        modelId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
      { minItems: 1, maxItems: 50 },
    ),
  }),
  execute: async (_toolCallId, params) => {
    const input = params as {
      employees: {
        id?: number;
        name?: string;
        role?: string;
        systemPrompt?: string;
        mcp?: string[];
        skills?: string[];
        modelId?: string | null;
      }[];
    };
    const ids = employeesService.upsertEmployees(
      input.employees.map((item) => ({ ...item })),
    );
    return toolResult({ ids });
  },
};

/** `create_chat` — new chat + one persistent session per participant. */
function createChatTool(env: AgentEnvironment): AnyPiTool {
  return {
    name: "create_chat",
    label: "Create chat",
    description:
      "Create a new chat with the given employee participants, initializing one persistent agent session per participant. " +
      "Optionally notify an existing chat via `card`.",
    promptSnippet: "create_chat (new team chat)",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 200 }),
      participants: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
      card: Type.Optional(Type.Object({ chatID: Type.String() })),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as {
        title: string;
        participants: number[];
        card?: { chatID: string };
      };
      for (const pid of input.participants) assertActiveEmployee(pid);

      const db = getDB();
      // Atomic: chat row + one session row per participant commit together.
      const { chat, sessionRecords } = db.transaction(() => {
        const chat = chatsService.createChat(input.title, input.participants);
        const records: EmployeeSession[] = [];
        for (const pid of chat.participants) {
          const path = sessionPathFor(chat.id, pid);
          sessionsService.setSession(pid, chat.id, path);
          records.push({
            employeeId: pid,
            chatId: chat.id,
            session: path,
            lastReadMessageId: 0,
          });
        }
        return { chat, sessionRecords: records };
      })();

      // Best-effort: materialize session files; never roll back committed DB.
      await Promise.all(
        sessionRecords.map((r) =>
          materializeSessionFile(r.session).catch(() => undefined),
        ),
      );

      if (input.card !== undefined) {
        const cardChatId = Number(input.card.chatID);
        if (!Number.isSafeInteger(cardChatId) || cardChatId <= 0) {
          throw new Error("card.chatID must be a valid chat id.");
        }
        await performSendMessage(env, {
          senderEmployeeId: ASSISTANT_ID,
          chatId: cardChatId,
          kind: "chat",
          content: String(chat.id),
          skipSenderCheck: true,
        });
        for (const record of sessionRecords) {
          fireAndForgetPrompt(
            env,
            record.employeeId,
            chat.id,
            READ_CHAT_PROMPT,
          );
        }
      }

      return toolResult({ chat, sessions: sessionRecords });
    },
  };
}

/** `send_message` — post as an active participant, optionally notifying others. */
function sendMessageTool(env: AgentEnvironment): AnyPiTool {
  return {
    name: "send_message",
    label: "Send message",
    description:
      "Send a message into a chat as one of the active participants, with optional file-path attachments " +
      "and notifications to other participants.",
    promptSnippet: "send_message (post to a chat)",
    parameters: Type.Object({
      senderEmployeeId: Type.Integer({ minimum: 0 }),
      chatId: Type.Integer({ minimum: 1 }),
      kind: Type.Optional(Type.String({ maxLength: 64 })),
      content: Type.String({ minLength: 1, maxLength: 100000 }),
      attachments: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
      notify: Type.Optional(
        Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 64 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as {
        senderEmployeeId: number;
        chatId: number;
        kind?: string;
        content: string;
        attachments?: string[];
        notify?: number[];
      };
      const message = await performSendMessage(env, {
        senderEmployeeId: input.senderEmployeeId,
        chatId: input.chatId,
        kind: input.kind,
        content: input.content,
        attachments: input.attachments,
        notify: input.notify,
      });
      return toolResult(message);
    },
  };
}

/** `read_chat` — advance the calling agent's cursor and return new messages. */
function readChatTool(employeeId: number): AnyPiTool {
  return {
    name: "read_chat",
    label: "Read chat",
    description:
      "Read the latest messages in a chat (after your read cursor) and advance that cursor.",
    promptSnippet: "read_chat (consume new messages)",
    parameters: Type.Object({
      chatId: Type.Integer({ minimum: 1 }),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as { chatId: number };
      const chat = chatsService.getChat(input.chatId);
      if (!chat) throw new Error("Chat does not exist.");
      await ensureSession(employeeId, input.chatId);
      const cursor = sessionsService.getReadCursor(employeeId, input.chatId);
      const messages = messagesService.listMessagesAfter(input.chatId, cursor);
      const nextCursor =
        messages.length > 0
          ? Math.max(...messages.map((message) => message.id))
          : cursor;
      if (nextCursor !== cursor) {
        sessionsService.setReadCursor(employeeId, input.chatId, nextCursor);
      }
      return toolResult({ chatId: input.chatId, cursor: nextCursor, messages });
    },
  };
}

/** `list_employees` — active employees, excluding the built-in assistant. */
const listEmployeesTool: AnyPiTool = {
  name: "list_employees",
  label: "List employees",
  description:
    "List all active employees (excluding the built-in assistant), ordered by id.",
  promptSnippet: "list_employees (active team members)",
  parameters: Type.Object({}),
  execute: async () => {
    const employees = employeesService
      .listEmployees()
      .filter((employee) => employee.id !== ASSISTANT_ID);
    return toolResult(employees);
  },
};

/** `notify` — bump a chat's unread and optionally raise an OS notification. */
const notifyTool: AnyPiTool = {
  name: "notify",
  label: "Notify",
  description:
    "Add a non-negative delta to a chat's unread counter and, when the app window " +
    "is not focused, show an OS notification that focuses the app and jumps to that chat.",
  promptSnippet: "notify (bump unread / OS notification)",
  parameters: Type.Object({
    chatId: Type.Integer({ minimum: 1 }),
    unread: Type.Integer({ minimum: 0 }),
    text: Type.String({ minLength: 1, maxLength: 1000 }),
  }),
  execute: async (_toolCallId, params) => {
    const input = params as { chatId: number; unread: number; text: string };
    const chat = chatsService.getChat(input.chatId);
    if (!chat) throw new Error("Chat does not exist.");
    const newUnread = notifyUnread(input.chatId, input.unread, input.text);
    return toolResult({ chatId: input.chatId, unread: newUnread });
  },
};

/** `set_cronjob` — create/update a scheduled task. */
const setCronjobTool: AnyPiTool = {
  name: "set_cronjob",
  label: "Set cron job",
  description:
    "Create or update a scheduled task. The id is a composite `chatId/employeeId/jobId`. " +
    "On each trigger the (employee, chat) agent session is loaded, the content is delivered, " +
    "and the reply is persisted as the employee's message.",
  promptSnippet: "set_cronjob (schedule a task)",
  parameters: Type.Object({
    id: Type.String({ minLength: 1, maxLength: 256 }),
    schedule: Type.String({ minLength: 1, maxLength: 128 }),
    content: Type.String({ minLength: 1, maxLength: 100000 }),
  }),
  execute: async (_toolCallId, params) => {
    const input = params as {
      id: string;
      schedule: string;
      content: string;
    };
    const parsed = parseCronJobId(input.id);
    return toolResult(
      cron.setJob({
        id: input.id,
        chatId: parsed.chatId,
        employeeId: parsed.employeeId,
        schedule: input.schedule,
        content: input.content,
      }),
    );
  },
};

/** `remove_cronjob` — delete a scheduled task by id. */
const removeCronjobTool: AnyPiTool = {
  name: "remove_cronjob",
  label: "Remove cron job",
  description: "Delete a scheduled task by its id.",
  promptSnippet: "remove_cronjob (delete a scheduled task)",
  parameters: Type.Object({
    id: Type.String({ minLength: 1, maxLength: 256 }),
  }),
  execute: async (_toolCallId, params) => {
    const input = params as { id: string };
    return toolResult({ removed: cron.removeJob(input.id) });
  },
};

/** `add_participant` — add members to a chat, notify, and prompt their agents. */
function addParticipantTool(env: AgentEnvironment): AnyPiTool {
  return {
    name: "add_participant",
    label: "Add participant",
    description:
      "Add participants to an existing chat, send a join notice, and prompt each new participant's agent session.",
    promptSnippet: "add_participant (add members to a chat)",
    parameters: Type.Object({
      chatId: Type.Integer({ minimum: 1 }),
      participants: Type.Array(
        Type.Object({
          employeeID: Type.Integer({ minimum: 1 }),
          prompt: Type.String({ minLength: 1, maxLength: 20000 }),
        }),
        { minItems: 1 },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as {
        chatId: number;
        participants: { employeeID: number; prompt: string }[];
      };
      const chat = chatsService.getChat(input.chatId);
      if (!chat) throw new Error("Chat does not exist.");

      // Only genuinely-new, active employees are added.
      const newParticipants = input.participants.filter(
        (p) => !chat.participants.includes(p.employeeID),
      );
      const add = newParticipants.map((p) => p.employeeID);
      for (const p of newParticipants) assertActiveEmployee(p.employeeID);
      if (add.length > 0) {
        const names = add.map(
          (id) => employeesService.getEmployee(id)?.name || `#${id}`,
        );
        const updated = chatsService.updateChatParticipants(input.chatId, {
          add,
        });
        if (!updated) throw new Error("Chat does not exist.");

        // Sender = orchestrating assistant; relaxed participant check (risk #1).
        await performSendMessage(env, {
          senderEmployeeId: ASSISTANT_ID,
          chatId: input.chatId,
          kind: "join_notice",
          content: `New participant(s) joined: ${names.join(", ")}`,
          skipSenderCheck: true,
        });

        const sessions: EmployeeSession[] = [];
        for (const participant of newParticipants) {
          await ensureSession(participant.employeeID, input.chatId);
          const record = sessionsService.getSession(
            participant.employeeID,
            input.chatId,
          );
          if (record) sessions.push(record);
          fireAndForgetPrompt(
            env,
            participant.employeeID,
            input.chatId,
            participant.prompt,
          );
        }
        return toolResult({
          chat: updated,
          added: add,
          sessions,
        });
      }

      return toolResult({ chat, added: [], sessions: [] });
    },
  };
}

// `add_participant` is intentionally NOT registered for any role (see plan
// §10.1); the definition is kept in the file for reference and re-enabled by
// uncommenting the push in `createTeamToolDefinitions`. Referenced here so the
// disabled definition is not reported as an unused local.
void addParticipantTool;

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Build the role-based tool set for the calling agent.
 *
 * - Assistant (id 0): orchestration tools — `set_employees`, `create_chat`,
 *   `send_message`, `read_chat`, `list_employees`, `notify`, `set_cronjob`,
 *   `remove_cronjob`.
 * - Participant employee: `send_message`, `read_chat` only.
 */
export function createTeamToolDefinitions(
  options: TeamToolOptions,
): AnyPiTool[] {
  const { env, employeeId } = options;
  const isAssistant = employeeId === ASSISTANT_ID;
  const tools: AnyPiTool[] = [];
  if (isAssistant) {
    tools.push(setEmployeesTool);
    tools.push(createChatTool(env));
    tools.push(listEmployeesTool);
    tools.push(notifyTool);
    tools.push(setCronjobTool);
    tools.push(removeCronjobTool);
  }
  tools.push(sendMessageTool(env));
  tools.push(readChatTool(employeeId));
  // add_participant is intentionally disabled for all roles (see plan §10.1);
  // kept in the file for reference and updated if re-enabled.
  // tools.push(addParticipantTool(env));
  return tools;
}
