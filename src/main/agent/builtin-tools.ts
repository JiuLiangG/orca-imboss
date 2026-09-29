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
  MessageStep,
  TeamToolOptions,
} from "@shared/types";
import { stat } from "fs/promises";
import { basename, extname } from "path";
import { Type } from "typebox";
import * as cron from "../cron";
import { getDB } from "../db";
import * as dbChats from "../db/chats";
import { parseCronJobId } from "../db/cron";
import * as dbEmployees from "../db/employees";
import * as dbMessages from "../db/messages";
import * as dbSessions from "../db/sessions";
import { notifyUnread } from "../notifications";
import {
  ensureSessionFile,
  materializeSessionFile,
  sessionPathFor,
} from "./session-files";
import { deliver } from "./session-queue";

/**
 * Imboss built-in team tools.
 *
 * LLM-callable tools that let the assistant orchestrate a team (create/edit
 * employees, create chats, send messages, schedule cron jobs, notify) and let
 * participant agents work inside chats. Backed by a persistent per-(employee,
 * chat) Pi session with a read cursor.
 *
 * The tool set is role-based: the assistant (employee id 0) gets the
 * orchestration tools (`imb_set_employees`, `imb_create_chat`,
 * `imb_send_message`, `imb_read_chat`, `imb_list_employees`, `imb_notify`);
 * a participant employee gets `imb_send_message`, `imb_read_chat`, `imb_ask`
 * and `imb_answer`, plus `imb_set_cronjob` and/or `imb_remove_cronjob` when
 * the employee opted in via their "Linked MCP" list. The two cron tools are
 * deliberately NOT part of the assistant's tool set. All agent runs are
 * serialized per (employee, chat) via the session queue.
 * `createTeamToolDefinitions` captures the calling agent's identity so
 * `imb_read_chat` knows who is reading and internal sends know who is sending.
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

// Session file materialization (`sessionPathFor` / `materializeSessionFile` /
// `ensureSessionFile`) lives in `./session-files`, shared with the session
// queue so every run — including the assistant's root chat — is persisted.

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
 * (`create_chat`, `add_participant.join_notice`).
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
    steps?: MessageStep[];
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
      steps: input.steps,
      attachments,
    },
  );

  for (const pid of input.notify ?? []) {
    if (!chat.participants.includes(pid)) continue;
    const target = dbEmployees.getEmployee(pid);
    if (!target || target.disabled) continue;
    await ensureSessionFile(pid, input.chatId);
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

/**
 * Log one `imb_*` tool invocation (name + caller + args). Entry-only by design:
 * no outcome/duration is recorded. Best-effort — a circular/unserializable
 * payload must never break a tool. Args are capped so huge prompts never flood
 * the console.
 */
function logToolCall(
  toolName: string,
  employeeId: number,
  chatId: number,
  params: unknown,
): void {
  let args: string;
  try {
    args = JSON.stringify(params) ?? String(params);
  } catch {
    args = "[unserializable]";
  }
  const max = 2000;
  const capped = args.length > max ? `${args.slice(0, max)}…` : args;
  console.log(
    `[imb-tool] ${toolName} caller=${employeeId}/${chatId} args=${capped}`,
  );
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
function setEmployeesTool(employeeId: number, chatId: number): AnyPiTool {
  return {
    name: "imb_set_employees",
    label: "Set employees",
    description:
      "Batch create or update employees (name, role, system prompt, linked MCP servers, skills, model). " +
      "Each item omits `id` to create a new employee or passes `id` to update an existing one. " +
      "Returns the array of employee ids created or updated.",
    promptSnippet: "batch create/edit employees",
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
      logToolCall("imb_set_employees", employeeId, chatId, params);
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
}

/** `imb_create_chat` — new chat + one persistent session per participant. */
function createChatTool(
  env: AgentEnvironment,
  employeeId: number,
  callingChatId: number,
): AnyPiTool {
  return {
    name: "imb_create_chat",
    label: "Create chat",
    description:
      "Create a new chat with the given employee participants, initializing one persistent agent session per participant. " +
      "The assistant always joins, and the chat that spawned this one is linked as `from_chat_id`. " +
      "Participants are NOT notified or started automatically — assign their work afterwards with `imb_send_message`, " +
      "passing their ids in `notify` to wake them.",
    promptSnippet: "new team chat",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 200 }),
      participants: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
    }),
    execute: async (_toolCallId, params) => {
      logToolCall("imb_create_chat", employeeId, callingChatId, params);
      const input = params as {
        title: string;
        participants: number[];
      };
      for (const pid of input.participants) assertActiveEmployee(pid);

      // The spawning chat must exist so the new chat can link back to it.
      // Validate before committing anything so a bad id never half-creates a
      // chat.
      if (!dbChats.getChat(callingChatId)) {
        throw new Error("Spawning chat does not exist.");
      }

      // The assistant joins every task chat it creates so participants can
      // notify it and it can post through the normal `imb_send_message` path.
      const participants = [...new Set([ASSISTANT_ID, ...input.participants])];

      const db = getDB();
      // Atomic: chat row + one session row per participant commit together.
      const { chat, sessionRecords } = db.transaction(() => {
        const chat = dbChats.createChat(
          input.title,
          participants,
          callingChatId,
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

      // Link the new chat back to its spawning chat with a `chat`-kind card.
      // No `notify` on purpose: creating a chat must NOT start any participant's
      // agent. They are woken only when an assignment reaches them through
      // `imb_send_message` with a `notify` list.
      await performSendMessage(env, {
        senderEmployeeId: ASSISTANT_ID,
        chatId: callingChatId,
        kind: "chat",
        content: String(chat.id),
        skipSenderCheck: true,
      });

      return toolResult({ chat, sessions: sessionRecords });
    },
  };
}

/** `imb_send_message` — post as an active participant, optionally notifying others. */
function sendMessageTool(
  env: AgentEnvironment,
  employeeId: number,
  chatId: number,
): AnyPiTool {
  return {
    name: "imb_send_message",
    label: "Send message",
    description:
      "Send a message into a chat as one of the active participants, with optional file-path attachments " +
      "and notifications to other participants. Use `kind` `report` to report a finished task's result; " +
      "the assistant may post `kind` `progress` with `steps` to publish a progress card.",
    promptSnippet: "post to a chat",
    parameters: Type.Object({
      senderEmployeeId: Type.Integer({ minimum: 0 }),
      chatId: Type.Integer({ minimum: 1 }),
      kind: Type.Optional(Type.String({ maxLength: 64 })),
      content: Type.String({ minLength: 1, maxLength: 100000 }),
      steps: Type.Optional(
        Type.Array(
          Type.Object({
            name: Type.String({ minLength: 1, maxLength: 256 }),
            role: Type.String({ maxLength: 256 }),
            status: Type.Union([Type.Literal("done"), Type.Literal("busy")]),
          }),
          { maxItems: 64 },
        ),
      ),
      attachments: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
      notify: Type.Optional(
        Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 64 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      logToolCall("imb_send_message", employeeId, chatId, params);
      const input = params as {
        senderEmployeeId: number;
        chatId: number;
        kind?: string;
        content: string;
        steps?: MessageStep[];
        attachments?: string[];
        notify?: number[];
      };
      // `steps` only make sense for a progress card, which is assistant-only.
      if (input.steps !== undefined && input.kind !== "progress") {
        throw new Error("`steps` is only valid with kind `progress`.");
      }
      if (
        (input.kind === "progress" || input.steps !== undefined) &&
        employeeId !== ASSISTANT_ID
      ) {
        throw new Error("Only the assistant can post task progress.");
      }
      const message = await performSendMessage(env, {
        senderEmployeeId: input.senderEmployeeId,
        chatId: input.chatId,
        kind: input.kind,
        content: input.content,
        steps: input.steps,
        attachments: input.attachments,
        notify: input.notify,
      });
      return toolResult(message);
    },
  };
}

/** `imb_read_chat` — advance the calling agent's cursor and return new messages. */
function readChatTool(employeeId: number, chatId: number): AnyPiTool {
  return {
    name: "imb_read_chat",
    label: "Read chat",
    description:
      "Read the latest messages in a chat (after your read cursor) and advance that cursor.",
    promptSnippet: "consume new messages",
    parameters: Type.Object({
      chatId: Type.Integer({ minimum: 1 }),
    }),
    execute: async (_toolCallId, params) => {
      logToolCall("imb_read_chat", employeeId, chatId, params);
      const input = params as { chatId: number };
      const chat = dbChats.getChat(input.chatId);
      if (!chat) throw new Error("Chat does not exist.");
      await ensureSessionFile(employeeId, input.chatId);
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
function listEmployeesTool(employeeId: number, chatId: number): AnyPiTool {
  return {
    name: "imb_list_employees",
    label: "List employees",
    description:
      "List all active employees (excluding the built-in assistant), ordered by id.",
    promptSnippet: "active team members",
    parameters: Type.Object({}),
    execute: async (_toolCallId, params) => {
      logToolCall("imb_list_employees", employeeId, chatId, params);
      const employees = dbEmployees
        .listEmployees()
        .filter((employee) => employee.id !== ASSISTANT_ID);
      return toolResult(employees);
    },
  };
}

/** `imb_notify` — bump a chat's unread and optionally raise an OS notification. */
function notifyTool(employeeId: number, chatId: number): AnyPiTool {
  return {
    name: "imb_notify",
    label: "Notify",
    description:
      "Add a non-negative delta to a chat's unread counter and, when the app window " +
      "is not focused, show an OS notification that focuses the app and jumps to that chat.",
    promptSnippet: "bump unread / OS notification",
    parameters: Type.Object({
      chatId: Type.Integer({ minimum: 1 }),
      unread: Type.Integer({ minimum: 0 }),
      text: Type.String({ minLength: 1, maxLength: 1000 }),
    }),
    execute: async (_toolCallId, params) => {
      logToolCall("imb_notify", employeeId, chatId, params);
      const input = params as { chatId: number; unread: number; text: string };
      const chat = dbChats.getChat(input.chatId);
      if (!chat) throw new Error("Chat does not exist.");
      const newUnread = notifyUnread(input.chatId, input.unread, input.text);
      return toolResult({ chatId: input.chatId, unread: newUnread });
    },
  };
}

/**
 * `imb_set_cronjob` — create/update a scheduled task.
 *
 * A participant (non-assistant) may only schedule for themselves, within a
 * chat they participate in; the assistant (id 0) remains unrestricted.
 */
function setCronjobTool(employeeId: number, chatId: number): AnyPiTool {
  return {
    name: "imb_set_cronjob",
    label: "Set cron job",
    description:
      "Create or update a scheduled task. The id is a composite `chatId/employeeId/jobId`. " +
      "On each trigger the content is delivered to the (employee, chat) agent session; " +
      "the agent must post its result with `imb_send_message`.",
    promptSnippet: "schedule a task",
    parameters: Type.Object({
      id: Type.String({ minLength: 1, maxLength: 256 }),
      schedule: Type.String({ minLength: 1, maxLength: 128 }),
      content: Type.String({ minLength: 1, maxLength: 100000 }),
    }),
    execute: async (_toolCallId, params) => {
      logToolCall("imb_set_cronjob", employeeId, chatId, params);
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
function removeCronjobTool(employeeId: number, chatId: number): AnyPiTool {
  return {
    name: "imb_remove_cronjob",
    label: "Remove cron job",
    description: "Delete a scheduled task by its id.",
    promptSnippet: "delete a scheduled task",
    parameters: Type.Object({
      id: Type.String({ minLength: 1, maxLength: 256 }),
    }),
    execute: async (_toolCallId, params) => {
      logToolCall("imb_remove_cronjob", employeeId, chatId, params);
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
function addParticipantTool(
  env: AgentEnvironment,
  employeeId: number,
  chatId: number,
): AnyPiTool {
  return {
    name: "imb_add_participant",
    label: "Add participant",
    description:
      "Add participants to an existing chat, send a join notice, and prompt each new participant's agent session.",
    promptSnippet: "add members to a chat",
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
      logToolCall("imb_add_participant", employeeId, chatId, params);
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
          await ensureSessionFile(participant.employeeID, input.chatId);
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
function imbAskTool(
  env: AgentEnvironment,
  employeeId: number,
  chatId: number,
): AnyPiTool {
  return {
    name: "imb_ask",
    label: "Ask a question",
    description:
      "Post a question set into a chat as one of the active participants and notify the specified " +
      "employees to answer. Each question offers candidate options (single or multiple) and/or a " +
      "free-form answer; the message body is the JSON serialization of the question set.",
    promptSnippet: "post a question set",
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
      logToolCall("imb_ask", employeeId, chatId, params);
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
function imbAnswerTool(
  env: AgentEnvironment,
  employeeId: number,
  chatId: number,
): AnyPiTool {
  return {
    name: "imb_answer",
    label: "Answer a question",
    description:
      "Post an answer to a previous question set into a chat as one of the active participants and " +
      "notify the specified employees. The message body is the JSON serialization of the answers.",
    promptSnippet: "post an answer",
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
      logToolCall("imb_answer", employeeId, chatId, params);
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
 *   `imb_create_chat`, `imb_read_chat`, `imb_list_employees`, `imb_notify`;
 *   plus `imb_send_message`, `imb_ask` and `imb_answer`. No cron tools.
 * - Participant employee: `imb_send_message`, `imb_read_chat`, `imb_ask`,
 *   `imb_answer`; plus `imb_set_cronjob` / `imb_remove_cronjob` when the
 *   corresponding opt-in marker is present in `mcp`.
 */
export function createTeamToolDefinitions(
  options: TeamToolOptions,
): AnyPiTool[] {
  const { env, employeeId, chatId } = options;
  const isAssistant = employeeId === ASSISTANT_ID;
  const mcp = options.mcp ?? [];
  const tools: AnyPiTool[] = [];
  if (isAssistant) {
    tools.push(setEmployeesTool(employeeId, chatId));
    tools.push(createChatTool(env, employeeId, chatId));
    tools.push(listEmployeesTool(employeeId, chatId));
    tools.push(notifyTool(employeeId, chatId));
    // `imb_set_cronjob` / `imb_remove_cronjob` are intentionally NOT given to
    // the assistant; they remain opt-in for participant employees only.
  } else {
    // Cron tools are opt-in: registered only when the employee selected the
    // corresponding marker in their "Linked MCP" list.
    if (mcp.includes(BUILTIN_SET_CRON_MARKER)) {
      tools.push(setCronjobTool(employeeId, chatId));
    }
    if (mcp.includes(BUILTIN_REMOVE_CRON_MARKER)) {
      tools.push(removeCronjobTool(employeeId, chatId));
    }
  }
  tools.push(sendMessageTool(env, employeeId, chatId));
  tools.push(readChatTool(employeeId, chatId));
  tools.push(imbAskTool(env, employeeId, chatId));
  tools.push(imbAnswerTool(env, employeeId, chatId));
  // add_participant is intentionally disabled for all roles (see plan §10.1);
  // kept in the file for reference and updated if re-enabled.
  // tools.push(addParticipantTool(env, employeeId, chatId));
  return tools;
}
