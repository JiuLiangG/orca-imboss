import { readChatPrompt } from "@shared/constants/prompts";

/**
 * Which task group a progress write may touch during one stretch of an
 * assistant run.
 *
 * A stretch starts at the run's prompt and again when a steered wake is
 * persisted. The group is the one the program already named (a task-group
 * wake), or the single group created since that stretch began, or — when
 * neither of those exists — the boss chat's only child group. Two candidates,
 * or none, authorize nothing: the write is refused instead of guessed.
 */
interface ProgressSegment {
  namedGroupId: number | null;
  createdGroupIds: number[];
}

const segments = new Map<string, ProgressSegment>();

function segmentKey(employeeId: number, chatId: number): string {
  return `${employeeId}/${chatId}`;
}

/**
 * The task-group id named by an assistant wake, or `null` when `text` is not
 * exactly that wake. A boss message that merely mentions a chat id does not
 * count.
 */
export function namedGroupInWake(text: string): number | null {
  const match = /^You have new messages in chat (\d+)\./.exec(text);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return text === readChatPrompt(id) ? id : null;
}

/** Start a stretch. Replaces whatever the previous stretch authorized. */
export function beginProgressSegment(
  employeeId: number,
  chatId: number,
  text: string,
): void {
  segments.set(segmentKey(employeeId, chatId), {
    namedGroupId: namedGroupInWake(text),
    createdGroupIds: [],
  });
}

/** Record a task group created by the assistant during the current stretch. */
export function noteCreatedProgressGroup(
  employeeId: number,
  chatId: number,
  groupId: number,
): void {
  const key = segmentKey(employeeId, chatId);
  const segment = segments.get(key) ?? {
    namedGroupId: null,
    createdGroupIds: [],
  };
  segment.createdGroupIds.push(groupId);
  segments.set(key, segment);
}

export function progressSegment(
  employeeId: number,
  chatId: number,
): ProgressSegment {
  return (
    segments.get(segmentKey(employeeId, chatId)) ?? {
      namedGroupId: null,
      createdGroupIds: [],
    }
  );
}

/**
 * The one group a progress write may name, or `null` when this stretch does
 * not have exactly one.
 */
export function resolveAuthorizedProgressGroup(input: {
  namedGroupId: number | null;
  createdGroupIds: readonly number[];
  childGroupIds: readonly number[];
}): number | null {
  const { namedGroupId, createdGroupIds, childGroupIds } = input;
  if (namedGroupId !== null && createdGroupIds.length === 0)
    return namedGroupId;
  if (namedGroupId === null && createdGroupIds.length === 1) {
    return createdGroupIds[0] ?? null;
  }
  if (
    namedGroupId === null &&
    createdGroupIds.length === 0 &&
    childGroupIds.length === 1
  ) {
    return childGroupIds[0] ?? null;
  }
  return null;
}

export interface ProgressCardSnapshot {
  id: number;
  employeeIds: readonly number[];
}

export type ProgressWriteDecision =
  | { action: "insert" }
  | { action: "update"; messageId: number }
  | { action: "reject"; reason: string };

function sameEmployeeIdSet(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * Choose the row a declared step list writes, without trusting the assistant
 * to remember a message id.
 *
 * The same set of employee ids as the latest card revises that card. A set
 * this group has not used yet inserts a new card. A set that repeats an
 * earlier card, or names someone outside the group, writes nothing.
 */
export function decideProgressWrite(input: {
  authorizedGroupId: number | null;
  requestedGroupId: number;
  participantIds: readonly number[];
  declaredEmployeeIds: readonly number[];
  existingCards: readonly ProgressCardSnapshot[];
}): ProgressWriteDecision {
  const { authorizedGroupId } = input;
  if (authorizedGroupId === null) {
    return {
      action: "reject",
      reason:
        "This turn has no single task group to attach progress to. The card was not written.",
    };
  }
  if (input.requestedGroupId !== authorizedGroupId) {
    return {
      action: "reject",
      reason:
        `Progress for this turn belongs to task group ${authorizedGroupId}, ` +
        `not ${input.requestedGroupId}. The card was not written.`,
    };
  }
  const participants = new Set(input.participantIds);
  for (const id of input.declaredEmployeeIds) {
    if (!participants.has(id)) {
      return {
        action: "reject",
        reason:
          `Employee ${id} is not a participant of task group ${authorizedGroupId}. ` +
          "The card was not written.",
      };
    }
  }
  const declared = new Set(input.declaredEmployeeIds);
  const latest = input.existingCards[input.existingCards.length - 1];
  if (!latest) return { action: "insert" };
  if (sameEmployeeIdSet(declared, new Set(latest.employeeIds))) {
    return { action: "update", messageId: latest.id };
  }
  for (const card of input.existingCards.slice(0, -1)) {
    if (sameEmployeeIdSet(declared, new Set(card.employeeIds))) {
      return {
        action: "reject",
        reason:
          `This step list repeats an earlier progress card for task group ${authorizedGroupId}. ` +
          "The current card was left unchanged.",
      };
    }
  }
  return { action: "insert" };
}
