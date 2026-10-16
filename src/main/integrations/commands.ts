import { ASSISTANT_ID } from "@shared/constants/employees";
import { t } from "@shared/l10n";
import type { IntegrationPlatform } from "@shared/types";
import * as dbChats from "../db/chats";
import * as dbIntegrations from "../db/integrations";
import { getDB } from "../db/index";
import { appendMessage } from "../db/messages";
import { sendToRenderer } from "../notifications";
import type { InboundMessage } from "./types";
import { errorMessage } from "./util";

/**
 * Inbound IM slash commands (WeChat / QQ / Telegram).
 *
 * Platform text is matched against a small alias table. Commands are consumed
 * as control instructions: they are neither stored as messages nor delivered to
 * the agent. They run inside the manager's per-`(platform, session)` serialized
 * queue, so a command and the next message are always processed in order.
 *
 * Recognized shape: the **entire** message (after trimming) is a single token
 * that equals an alias, case-insensitively for ASCII. Aliases with arguments,
 * full-width slashes (`／new`), and Telegram-style `/new@bot` are intentionally
 * not recognized and fall through to normal message handling. A message that
 * carries media attachments is never treated as a command — the caller gates
 * on `media.length === 0` so attached media is never dropped.
 */

export type InboundCommandName = "new";

export interface InboundCommand {
  name: InboundCommandName;
}

/** Alias → canonical command name (a Map so arbitrary text can never hit an
 * object prototype key such as `constructor`/`toString`). */
const COMMAND_ALIASES = new Map<string, InboundCommandName>([
  ["/new", "new"],
  ["/新对话", "new"],
]);

/**
 * Parse one inbound message's text as a command, or null when it is an ordinary
 * message. Only whitespace-free, single-token aliases are accepted.
 */
export function parseCommand(text: string): InboundCommand | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
  const name = COMMAND_ALIASES.get(trimmed.toLowerCase());
  return name === undefined ? null : { name };
}

/** Run a parsed command. Failures are contained so they never wedge inbound. */
export function handleCommand(
  platform: IntegrationPlatform,
  message: InboundMessage,
  command: InboundCommand,
): void {
  switch (command.name) {
    case "new":
      startNewConversation(platform, message);
      return;
  }
}

/**
 * `/new` · `/新对话`: create a fresh chat for the platform conversation and
 * move the binding onto it.
 *
 * The old chat is detached (its `source*` columns are cleared) and the new chat
 * takes the conversation's `(source, source_session)` binding in one
 * transaction — required because of the partial unique index. The old chat is
 * left as a normal, usable local conversation.
 */
function startNewConversation(
  platform: IntegrationPlatform,
  message: InboundMessage,
): void {
  const previousChatId = dbIntegrations.findChatBySession(
    platform,
    message.sessionId,
  );
  // Keep the freshest reply credential even when the command message carries
  // none (e.g. Telegram), so the first reply in the new chat still reaches the
  // platform.
  const previousContext =
    previousChatId === null
      ? null
      : (dbIntegrations.getChatSource(previousChatId)?.context ?? null);

  const db = getDB();
  const createChat = db.transaction((): number => {
    if (previousChatId !== null) {
      dbIntegrations.detachChatSource(previousChatId);
    }
    const chat = dbChats.createChat("", [ASSISTANT_ID], {
      source: platform,
      sourceSession: message.sessionId,
      sourceContext: message.replyContext ?? previousContext,
    });
    return chat.id;
  });

  let chatId: number;
  try {
    chatId = createChat();
  } catch (err) {
    console.error(
      `[integrations:${platform}] failed to start a new conversation:`,
      errorMessage(err),
    );
    return;
  }

  // The old chat keeps its history but loses its platform chip in the list and
  // header; refresh its cached summary like a title/tag change does.
  if (previousChatId !== null) {
    sendToRenderer("chats:changed", { chatId: previousChatId });
  }

  // Localized acknowledgement in the new chat. Appending it via the normal
  // write path both records it in-app and forwards it to the platform through
  // the outbound pipeline. A failure here must not undo the switch.
  try {
    appendMessage(chatId, ASSISTANT_ID, t("New conversation started."));
  } catch (err) {
    console.error(
      `[integrations:${platform}] failed to append the new-conversation notice:`,
      errorMessage(err),
    );
  }
}
