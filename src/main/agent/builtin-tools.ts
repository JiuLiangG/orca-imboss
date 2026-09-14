import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  BUILTIN_REMOVE_CRON_MARKER,
  BUILTIN_SET_CRON_MARKER,
} from "@shared/constants/agent_tools";
import { ASSISTANT_ID } from "@shared/constants/employees";
import { READ_CHAT_PROMPT } from "@shared/constants/prompts";
import type {
  AgentEnvironment,
  AnyPiTool,
  EmployeeSession,
  Message,
  MessageAttachment,
  TeamToolOptions,
} from "@shared/types";
import { mkdir, stat, writeFile } from "fs/promises";
import { homedir } from "os";
import { basename, dirname, extname, join } from "path";
import { Type } from "typebox";
import * as cron from "../cron";
import { getAgentSessionsDir } from "../data-dir";
import { getDB } from "../db";
import * as dbChats from "../db/chats";
import { parseCronJobId } from "../db/cron";
import * as dbEmployees from "../db/employees";
import * as dbMessages from "../db/messages";
import * as dbSessions from "../db/sessions";
import { notifyUnread } from "../notifications";
import { loadPiSdk } from "./pi-sdk";
import { deliver } from "./session-queue";

/**
 * Imboss built-in team tools.
 *
 * LLM-callable tools that let the assistant orchestrate a team (create/edit
 * employees, create chats, send messages, schedule cron jobs, notify) and let
 * participant agents work inside chats. Backed by a persistent per-(employee,
 * chat) Pi session with a read cursor.
 *
 * The tool set is role-based: the assistant (employee id 0) gets every
 * orchestration tool (`imb_set_employees`, `imb_create_chat`,
 * `imb_send_message`, `imb_read_chat`, `imb_list_employees`, `imb_notify`,
 * `imb_set_cronjob`, `imb_remove_cronjob`); a participant employee gets
 * `imb_send_message`, `imb_read_chat`, `imb_ask` and `imb_answer`, plus
 * `imb_set_cronjob` and/or `imb_remove_cronjob` when the employee opted in via
 * their "Linked MCP" list. All agent runs are serialized per (employee, chat)
 * via the session queue. `createTeamToolDefinitions` captures the calling
 * agent's identity so `imb_read_chat` knows who is reading and internal sends
 * know who is sending.
 */

const getEmployee = dbEmployees.getEmployee;

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
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
  if (dbSessions.getSession(employeeId, chatId)) return;
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
  dbSessions.setSession(employeeId, chatId, path);
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

function mimeByExtension(path: string): string {
  const ext = extname(path).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

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
  const chat = dbChats.getChat(input.chatId);
  if (!chat) throw new Error("Chat does not exist.");
  if (
    !input.skipSenderCheck &&
    !chat.participants.includes(input.senderEmployeeId)
  ) {
    throw new Error("Sender is not a participant of this chat.");
  }
  const sender = dbEmployees.getEmployee(input.senderEmployeeId);
  if (!sender || sender.disabled) {
    throw new Error("Sender is not an active employee.");
  }
  const attachments = await resolveAttachments(input.attachments);
  const message = dbMessages.appendMessage(
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
    const target = dbEmployees.getEmployee(pid);
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

/** `imb_set_employees` — batch create (omit `id`) or update (pass `id`) employees. */
const setEmployeesTool: AnyPiTool = {
  name: "imb_set_employees",
  label: "Set employees",
  description:
    "Batch create or update employees (name, role, system prompt, linked MCP servers, skills, model). " +
    "Each item omits `id` to create a new employee or passes `id` to update an existing one. " +
    "Returns the array of employee ids created or updated.",
  promptSnippet: "imb_set_employees (batch create/edit employees)",
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
    const ids = dbEmployees.upsertEmployees(
      input.employees.map((item) => ({ ...item })),
    );
    return toolResult({ ids });
  },
};

/** `imb_create_chat` — new chat + one persistent session per participant. */
function createChatTool(env: AgentEnvironment): AnyPiTool {
  return {
    name: "imb_create_chat",
    label: "Create chat",
    description:
      "Create a new chat with the given employee participants, initializing one persistent agent session per participant. " +
      "Optionally notify an existing chat via `card`.",
    promptSnippet: "imb_create_chat (new team chat)",
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

      // An optional `card.chatID` links the new group chat back to the user
      // chat that spawned it (`from`). Validate it before committing anything
      // so an invalid id never leaves a half-created chat behind.
      let cardChatId: number | undefined;
      if (input.card !== undefined) {
        cardChatId = Number(input.card.chatID);
        if (!Number.isSafeInteger(cardChatId) || cardChatId <= 0) {
          throw new Error("card.chatID must be a valid chat id.");
        }
      }

      const db = getDB();
      // Atomic: chat row + one session row per participant commit together.
      const { chat, sessionRecords } = db.transaction(() => {
        const chat = dbChats.createChat(
          input.title,
          input.participants,
          cardChatId,
        );
        const records: EmployeeSession[] = [];
        for (const pid of chat.participants) {
          const path = sessionPathFor(chat.id, pid);
          dbSessions.setSession(pid, chat.id, path);
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

      if (cardChatId !== undefined) {
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

/** `imb_send_message` — post as an active participant, optionally notifying others. */
function sendMessageTool(env: AgentEnvironment): AnyPiTool {
  return {
    name: "imb_send_message",
    label: "Send message",
    description:
      "Send a message into a chat as one of the active participants, with optional file-path attachments " +
      "and notifications to other participants.",
    promptSnippet: "imb_send_message (post to a chat)",
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

/** `imb_read_chat` — advance the calling agent's cursor and return new messages. */
function readChatTool(employeeId: number): AnyPiTool {
  return {
    name: "imb_read_chat",
    label: "Read chat",
    description:
      "Read the latest messages in a chat (after your read cursor) and advance that cursor.",
    promptSnippet: "imb_read_chat (consume new messages)",
    parameters: Type.Object({
      chatId: Type.Integer({ minimum: 1 }),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as { chatId: number };
      const chat = dbChats.getChat(input.chatId);
      if (!chat) throw new Error("Chat does not exist.");
      await ensureSession(employeeId, input.chatId);
      const cursor = dbSessions.getReadCursor(employeeId, input.chatId);
      const messages = dbMessages.listMessagesAfter(input.chatId, cursor);
      const nextCursor =
        messages.length > 0
          ? Math.max(...messages.map((message) => message.id))
          : cursor;
      if (nextCursor !== cursor) {
        dbSessions.setReadCursor(employeeId, input.chatId, nextCursor);
      }
      return toolResult({
        chatId: input.chatId,
        from: chat.fromChatId,
        cursor: nextCursor,
        messages,
      });
    },
  };
}

/** `imb_list_employees` — active employees, excluding the built-in assistant. */
const listEmployeesTool: AnyPiTool = {
  name: "imb_list_employees",
  label: "List employees",
  description:
    "List all active employees (excluding the built-in assistant), ordered by id.",
  promptSnippet: "imb_list_employees (active team members)",
  parameters: Type.Object({}),
  execute: async () => {
    const employees = dbEmployees
      .listEmployees()
      .filter((employee) => employee.id !== ASSISTANT_ID);
    return toolResult(employees);
  },
};

/** `imb_notify` — bump a chat's unread and optionally raise an OS notification. */
const notifyTool: AnyPiTool = {
  name: "imb_notify",
  label: "Notify",
  description:
    "Add a non-negative delta to a chat's unread counter and, when the app window " +
    "is not focused, show an OS notification that focuses the app and jumps to that chat.",
  promptSnippet: "imb_notify (bump unread / OS notification)",
  parameters: Type.Object({
    chatId: Type.Integer({ minimum: 1 }),
    unread: Type.Integer({ minimum: 0 }),
    text: Type.String({ minLength: 1, maxLength: 1000 }),
  }),
  execute: async (_toolCallId, params) => {
    const input = params as { chatId: number; unread: number; text: string };
    const chat = dbChats.getChat(input.chatId);
    if (!chat) throw new Error("Chat does not exist.");
    const newUnread = notifyUnread(input.chatId, input.unread, input.text);
    return toolResult({ chatId: input.chatId, unread: newUnread });
  },
};

/**
 * `imb_set_cronjob` — create/update a scheduled task.
 *
 * A participant (non-assistant) may only schedule for themselves, within a
 * chat they participate in; the assistant (id 0) remains unrestricted.
 */
function setCronjobTool(employeeId: number): AnyPiTool {
  return {
    name: "imb_set_cronjob",
    label: "Set cron job",
    description:
      "Create or update a scheduled task. The id is a composite `chatId/employeeId/jobId`. " +
      "On each trigger the (employee, chat) agent session is loaded, the content is delivered, " +
      "and the reply is persisted as the employee's message.",
    promptSnippet: "imb_set_cronjob (schedule a task)",
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
      if (employeeId !== ASSISTANT_ID) {
        if (parsed.employeeId !== employeeId) {
          throw new Error("An employee can only schedule their own cron job.");
        }
        const chat = dbChats.getChat(parsed.chatId);
        if (!chat || !chat.participants.includes(employeeId)) {
          throw new Error(
            "An employee can only schedule cron jobs for chats they participate in.",
          );
        }
      }
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
}

/**
 * `imb_remove_cronjob` — delete a scheduled task by id.
 *
 * A participant may only remove their own cron jobs; the assistant can remove any.
 */
function removeCronjobTool(employeeId: number): AnyPiTool {
  return {
    name: "imb_remove_cronjob",
    label: "Remove cron job",
    description: "Delete a scheduled task by its id.",
    promptSnippet: "imb_remove_cronjob (delete a scheduled task)",
    parameters: Type.Object({
      id: Type.String({ minLength: 1, maxLength: 256 }),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as { id: string };
      if (employeeId !== ASSISTANT_ID) {
        const parsed = parseCronJobId(input.id);
        if (parsed.employeeId !== employeeId) {
          throw new Error("An employee can only remove their own cron job.");
        }
      }
      return toolResult({ removed: cron.removeJob(input.id) });
    },
  };
}

/** `imb_add_participant` — add members to a chat, notify, and prompt their agents. */
function addParticipantTool(env: AgentEnvironment): AnyPiTool {
  return {
    name: "imb_add_participant",
    label: "Add participant",
    description:
      "Add participants to an existing chat, send a join notice, and prompt each new participant's agent session.",
    promptSnippet: "imb_add_participant (add members to a chat)",
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
      const chat = dbChats.getChat(input.chatId);
      if (!chat) throw new Error("Chat does not exist.");

      // Only genuinely-new, active employees are added.
      const newParticipants = input.participants.filter(
        (p) => !chat.participants.includes(p.employeeID),
      );
      const add = newParticipants.map((p) => p.employeeID);
      for (const p of newParticipants) assertActiveEmployee(p.employeeID);
      if (add.length > 0) {
        const names = add.map(
          (id) => dbEmployees.getEmployee(id)?.name || `#${id}`,
        );
        const updated = dbChats.updateChatParticipants(input.chatId, {
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
          const record = dbSessions.getSession(
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

/** `imb_ask` — post a structured question set into a chat, notifying respondents. */
function imbAskTool(env: AgentEnvironment): AnyPiTool {
  return {
    name: "imb_ask",
    label: "Ask a question",
    description:
      "Post a question set into a chat as one of the active participants and notify the specified " +
      "employees to answer. Each question offers candidate options (single or multiple) and/or a " +
      "free-form answer; the message body is the JSON serialization of the question set.",
    promptSnippet: "imb_ask (post a question set)",
    parameters: Type.Object({
      senderEmployeeId: Type.Integer({ minimum: 0 }),
      chatId: Type.Integer({ minimum: 1 }),
      questions: Type.Object({
        questions: Type.Array(
          Type.Object({
            id: Type.String({ minLength: 1, maxLength: 128 }),
            text: Type.String({ minLength: 1, maxLength: 2000 }),
            type: Type.Optional(
              Type.Union([
                Type.Literal("single"),
                Type.Literal("multiple"),
                Type.Literal("free"),
              ]),
            ),
            options: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
          }),
          { minItems: 1, maxItems: 32 },
        ),
      }),
      notify: Type.Array(Type.Integer({ minimum: 1 }), {
        minItems: 1,
        maxItems: 64,
      }),
      attachments: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as {
        senderEmployeeId: number;
        chatId: number;
        questions: {
          questions: {
            id: string;
            text: string;
            type?: string;
            options?: string[];
          }[];
        };
        notify: number[];
        attachments?: string[];
      };
      const message = await performSendMessage(env, {
        senderEmployeeId: input.senderEmployeeId,
        chatId: input.chatId,
        kind: "ask",
        content: JSON.stringify(input.questions),
        attachments: input.attachments,
        notify: input.notify,
      });
      return toolResult(message);
    },
  };
}

/** `imb_answer` — post an answer to a question set into a chat, notifying others. */
function imbAnswerTool(env: AgentEnvironment): AnyPiTool {
  return {
    name: "imb_answer",
    label: "Answer a question",
    description:
      "Post an answer to a previous question set into a chat as one of the active participants and " +
      "notify the specified employees. The message body is the JSON serialization of the answers.",
    promptSnippet: "imb_answer (post an answer)",
    parameters: Type.Object({
      senderEmployeeId: Type.Integer({ minimum: 0 }),
      chatId: Type.Integer({ minimum: 1 }),
      answers: Type.Object({
        answers: Type.Array(
          Type.Object({
            questionId: Type.String({ minLength: 1, maxLength: 128 }),
            selected: Type.Optional(
              Type.Array(Type.String(), { maxItems: 64 }),
            ),
            text: Type.Optional(Type.String({ maxLength: 4000 })),
          }),
          { minItems: 1, maxItems: 32 },
        ),
      }),
      notify: Type.Array(Type.Integer({ minimum: 1 }), {
        minItems: 1,
        maxItems: 64,
      }),
      attachments: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as {
        senderEmployeeId: number;
        chatId: number;
        answers: {
          answers: {
            questionId: string;
            selected?: string[];
            text?: string;
          }[];
        };
        notify: number[];
        attachments?: string[];
      };
      const message = await performSendMessage(env, {
        senderEmployeeId: input.senderEmployeeId,
        chatId: input.chatId,
        kind: "answer",
        content: JSON.stringify(input.answers),
        attachments: input.attachments,
        notify: input.notify,
      });
      return toolResult(message);
    },
  };
}

// `add_participant` is intentionally NOT registered for any role (see plan
// §10.1); the definition is kept in the file for reference and re-enabled by
// uncommenting the push in `createTeamToolDefinitions`. Referenced here so the
// disabled definition is not reported as an unused local.
void addParticipantTool;

/**
 * Build the role-based tool set for the calling agent.
 *
 * - Assistant (id 0): orchestration tools — `imb_set_employees`,
 *   `imb_create_chat`, `imb_read_chat`, `imb_list_employees`, `imb_notify`,
 *   `imb_set_cronjob`, `imb_remove_cronjob`; plus `imb_send_message`,
 *   `imb_ask` and `imb_answer`.
 * - Participant employee: `imb_send_message`, `imb_read_chat`, `imb_ask`,
 *   `imb_answer`; plus `imb_set_cronjob` / `imb_remove_cronjob` when the
 *   corresponding opt-in marker is present in `mcp`.
 */
export function createTeamToolDefinitions(
  options: TeamToolOptions,
): AnyPiTool[] {
  const { env, employeeId } = options;
  const isAssistant = employeeId === ASSISTANT_ID;
  const mcp = options.mcp ?? [];
  const tools: AnyPiTool[] = [];
  if (isAssistant) {
    tools.push(setEmployeesTool);
    tools.push(createChatTool(env));
    tools.push(listEmployeesTool);
    tools.push(notifyTool);
    tools.push(setCronjobTool(employeeId));
    tools.push(removeCronjobTool(employeeId));
  } else {
    // Cron tools are opt-in: registered only when the employee selected the
    // corresponding marker in their "Linked MCP" list.
    if (mcp.includes(BUILTIN_SET_CRON_MARKER)) {
      tools.push(setCronjobTool(employeeId));
    }
    if (mcp.includes(BUILTIN_REMOVE_CRON_MARKER)) {
      tools.push(removeCronjobTool(employeeId));
    }
  }
  tools.push(sendMessageTool(env));
  tools.push(readChatTool(employeeId));
  tools.push(imbAskTool(env));
  tools.push(imbAnswerTool(env));
  // add_participant is intentionally disabled for all roles (see plan §10.1);
  // kept in the file for reference and updated if re-enabled.
  // tools.push(addParticipantTool(env));
  return tools;
}
