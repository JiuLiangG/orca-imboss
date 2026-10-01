import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  BUILTIN_REMOVE_CRON_MARKER,
  BUILTIN_SET_CRON_MARKER,
} from "@shared/constants/agent_tools";
import {
  MAX_ATTACHMENT_TOTAL,
  MAX_TOOL_ATTACHMENTS,
} from "@shared/constants/attachments";
import { ASSISTANT_ID } from "@shared/constants/employees";
import { READ_CHAT_PROMPT } from "@shared/constants/prompts";
import type {
  AgentEnvironment,
  AnyPiTool,
  CronJob,
  Employee,
  EmployeeSession,
  Message,
  MessageAttachment,
  MessageKind,
  MessageStep,
  TeamToolOptions,
} from "@shared/types";
import { stat } from "fs/promises";
import { basename, extname, resolve } from "path";
import { Type } from "typebox";
import * as cron from "../cron";
import { getDB } from "../db";
import * as dbChats from "../db/chats";
import { parseCronJobId } from "../db/cron";
import * as dbEmployees from "../db/employees";
import * as dbMessages from "../db/messages";
import * as dbReadCursors from "../db/read-cursors";
import * as dbSessions from "../db/sessions";
import { notifyUnread } from "../notifications";
import { materializeSessionFile, sessionPathFor } from "./session-files";
import { wakeAgent } from "./session-queue";

/**
 * Imboss built-in team tools.
 *
 * LLM-callable tools that let the assistant orchestrate a team (create/edit
 * employees, create chats, send messages, schedule cron jobs, notify) and let
 * participant agents work inside chats. Backed by a persistent per-(employee,
 * chat) Pi session with a read cursor. The assistant has no session in task
 * group chats: it reads them from its root-chat session on `wakeAgent`.
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

// Session file materialization (`sessionPathFor` / `materializeSessionFile`)
// lives in `./session-files`, shared with the session queue so every run —
// including the assistant's root chat — is persisted. Waking a participant goes
// through `wakeAgent`, which redirects the assistant to its root-chat session.

function mimeByExtension(path: string): string {
  const ext = extname(path).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Resolve file paths → attachment metadata (name/size/type/path); no previews. */
async function resolveAttachments(
  paths: string[] | undefined,
): Promise<MessageAttachment[] | undefined> {
  if (!paths || paths.length === 0) return undefined;
  if (paths.length > MAX_TOOL_ATTACHMENTS) {
    throw new Error("Too many attachments.");
  }
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
      // Store an absolute path (matching how `stat` resolved it) so the file
      // can later be revealed in the OS file manager.
      path: resolve(path),
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
  _env: AgentEnvironment,
  input: {
    senderEmployeeId: number;
    chatId: number;
    kind?: string;
    content: string;
    steps?: MessageStep[];
    attachments?: string[];
    attachmentTotal?: number;
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
      attachmentTotal: input.attachmentTotal,
    },
  );

  for (const pid of input.notify ?? []) {
    if (!chat.participants.includes(pid)) continue;
    const target = dbEmployees.getEmployee(pid);
    if (!target || target.disabled) continue;
    // `wakeAgent` redirects the assistant (id 0) from a task group chat to its
    // root-chat session; participants run in their own (pid, chat) session.
    await wakeAgent(pid, input.chatId, input.notifyPrompt ?? READ_CHAT_PROMPT);
  }
  return message;
}

/**
 * Wrap a tool payload as a Pi text tool result.
 *
 * `details` is deliberately empty: the SDK never sends it to the model and no
 * app code reads it, yet it is persisted in the session file — mirroring the
 * payload there would double every tool result. Only `content` is meaningful,
 * so the model receives `JSON.stringify(value)` once.
 */
function toolResult(value: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: {},
  };
}

/**
 * Slim employee projection: keeps what the orchestrator uses (id for
 * @-mentions/notify, name/role for step cards, skills/mcp to judge fit) and
 * drops the rest — notably the full `systemPrompt` and the base64 `avatarUrl`.
 */
interface EmployeeBrief {
  id: number;
  name: string;
  role: string;
  skills: string[];
  mcp: string[];
}

function toEmployeeBrief(employee: Employee): EmployeeBrief {
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    skills: employee.skills,
    mcp: employee.mcp,
  };
}

/** Slim message projection; `steps`/`attachments` are omitted when absent. */
interface MessageBrief {
  id: number;
  senderEmployeeId: number | null;
  kind: MessageKind;
  content: string;
  steps?: MessageStep[];
  attachments?: MessageAttachment[];
  /** True attachment count when it exceeds the metadata rows forwarded. */
  attachmentsTotal?: number;
  createdAt: number;
}

function toMessageBrief(message: Message): MessageBrief {
  const brief: MessageBrief = {
    id: message.id,
    senderEmployeeId: message.senderEmployeeId,
    kind: message.kind,
    content: message.content,
    createdAt: message.createdAt,
  };
  if (message.steps && message.steps.length > 0) brief.steps = message.steps;
  if (message.attachments && message.attachments.length > 0) {
    // Strip the on-disk `path`: the model has its own filesystem tools and
    // must not receive local paths through the chat brief.
    brief.attachments = message.attachments.map((attachment) => ({
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
    }));
    if (
      message.attachmentsTotal !== null &&
      message.attachmentsTotal > message.attachments.length
    ) {
      brief.attachmentsTotal = message.attachmentsTotal;
    }
  }
  return brief;
}

/** Slim cron job projection: enough to confirm the schedule, no echoed content. */
interface CronJobBrief {
  id: string;
  schedule: string;
  nextRunAt: number | null;
}

function toCronJobBrief(job: CronJob): CronJobBrief {
  return { id: job.id, schedule: job.schedule, nextRunAt: job.nextRunAt };
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
      "Batch create or update employees (name, role, system prompt, linked MCP servers, skills, model, thinking level). " +
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
          thinkingLevel: Type.Optional(
            Type.Union([
              Type.Literal("off"),
              Type.Literal("low"),
              Type.Literal("medium"),
              Type.Literal("high"),
              Type.Literal("xhigh"),
              Type.Literal("max"),
              Type.Null(),
            ]),
          ),
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
          thinkingLevel?:
            "off" | "low" | "medium" | "high" | "xhigh" | "max" | null;
        }[];
      };
      const ids = dbEmployees.upsertEmployees(
        input.employees.map((item) => ({ ...item })),
      );
      return toolResult({ ids });
    },
  };
}

/** `imb_create_chat` — new chat + one persistent session per employee. */
function createChatTool(
  env: AgentEnvironment,
  employeeId: number,
  callingChatId: number,
): AnyPiTool {
  return {
    name: "imb_create_chat",
    label: "Create chat",
    description:
      "Create a new chat with the given employee participants, initializing one persistent agent session per employee participant " +
      "(the assistant orchestrates from its own root-chat session and gets no session here). " +
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
      // Atomic: chat row + one session row per employee participant commit
      // together. The assistant is deliberately skipped — it has no session in
      // a task group chat and reads it from its root-chat session instead.
      const { chat, sessionRecords } = db.transaction(() => {
        const chat = dbChats.createChat(
          input.title,
          participants,
          callingChatId,
        );
        const records: EmployeeSession[] = [];
        for (const pid of chat.participants) {
          if (pid === ASSISTANT_ID) continue;
          const path = sessionPathFor(chat.id, pid);
          dbSessions.setSession(pid, chat.id, path);
          records.push({
            employeeId: pid,
            chatId: chat.id,
            session: path,
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

      return toolResult({
        chatId: chat.id,
        participants: chat.participants,
      });
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
      "(at most 5; pass `attachmentTotal` when more files were produced) and notifications to other " +
      "participants. Use `kind` `report` to report a finished task's result; " +
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
      attachments: Type.Optional(
        Type.Array(Type.String(), { maxItems: MAX_TOOL_ATTACHMENTS }),
      ),
      attachmentTotal: Type.Optional(
        Type.Integer({ minimum: 0, maximum: MAX_ATTACHMENT_TOTAL }),
      ),
      notify: Type.Optional(
        Type.Array(Type.Integer({ minimum: 0 }), { maxItems: 64 }),
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
        attachmentTotal?: number;
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
        attachmentTotal: input.attachmentTotal,
        notify: input.notify,
      });
      return toolResult({ id: message.id });
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
      // Cursors live in their own table: the assistant reads task group chats
      // from its root-chat session and has no `sessions` row there.
      const cursor = dbReadCursors.getReadCursor(employeeId, input.chatId);
      const messages = dbMessages.listMessagesAfter(input.chatId, cursor);
      const nextCursor =
        messages.length > 0
          ? Math.max(...messages.map((message) => message.id))
          : cursor;
      if (nextCursor !== cursor) {
        dbReadCursors.setReadCursor(employeeId, input.chatId, nextCursor);
      }
      return toolResult({
        from: chat.fromChatId,
        // App-generated receipt acks are noise for the model; the cursor above
        // still advances past them so they are never re-read.
        messages: messages
          .filter((message) => message.kind !== "ack")
          .map(toMessageBrief),
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
      return toolResult(employees.map(toEmployeeBrief));
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
      const job = cron.setJob({
        id: input.id,
        chatId: parsed.chatId,
        employeeId: parsed.employeeId,
        schedule: input.schedule,
        content: input.content,
      });
      return toolResult(toCronJobBrief(job));
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

        for (const participant of newParticipants) {
          await wakeAgent(
            participant.employeeID,
            input.chatId,
            participant.prompt,
          );
        }
        return toolResult({ chatId: updated.id, added: add });
      }

      return toolResult({ chatId: chat.id, added: [] });
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
      "free-form answer; the message body is the JSON serialization of the question set. " +
      "Attachments are capped at 5; pass `attachmentTotal` when more files were produced.",
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
      notify: Type.Array(Type.Integer({ minimum: 0 }), {
        minItems: 1,
        maxItems: 64,
      }),
      attachments: Type.Optional(
        Type.Array(Type.String(), { maxItems: MAX_TOOL_ATTACHMENTS }),
      ),
      attachmentTotal: Type.Optional(
        Type.Integer({ minimum: 0, maximum: MAX_ATTACHMENT_TOTAL }),
      ),
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
        attachmentTotal?: number;
      };
      const message = await performSendMessage(env, {
        senderEmployeeId: input.senderEmployeeId,
        chatId: input.chatId,
        kind: "ask",
        content: JSON.stringify(input.questions),
        attachments: input.attachments,
        attachmentTotal: input.attachmentTotal,
        notify: input.notify,
      });
      return toolResult({ id: message.id });
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
      "notify the specified employees. The message body is the JSON serialization of the answers. " +
      "Attachments are capped at 5; pass `attachmentTotal` when more files were produced.",
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
      notify: Type.Array(Type.Integer({ minimum: 0 }), {
        minItems: 1,
        maxItems: 64,
      }),
      attachments: Type.Optional(
        Type.Array(Type.String(), { maxItems: MAX_TOOL_ATTACHMENTS }),
      ),
      attachmentTotal: Type.Optional(
        Type.Integer({ minimum: 0, maximum: MAX_ATTACHMENT_TOTAL }),
      ),
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
        attachmentTotal?: number;
      };
      const message = await performSendMessage(env, {
        senderEmployeeId: input.senderEmployeeId,
        chatId: input.chatId,
        kind: "answer",
        content: JSON.stringify(input.answers),
        attachments: input.attachments,
        attachmentTotal: input.attachmentTotal,
        notify: input.notify,
      });
      return toolResult({ id: message.id });
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
