import { useCallback, useEffect, useMemo } from "react";
import { appStore, useApp } from "../../app-store";

export interface MentionResolver {
  /** Employee id → display name; `null` for unknown/empty names (keeps raw `@<id>`). */
  resolveMention: (id: number) => string | null;
  /** Present only in interactive contexts; opens the employee's agent session for `chatId`. */
  onMentionClick?: (id: number) => void;
}

/**
 * Resolve `@<id>` mentions against the centralized employee collection.
 *
 * `interactive` is opt-in because a mention can live inside markup where a
 * click target is unsafe or meaningless (ask-card option labels are `<label>`s,
 * the agent-session transcript is debug-oriented, plain-text previews). When
 * `false`, `onMentionClick` is omitted and the Markdown component renders a
 * non-interactive themed span.
 */
export function useMentionResolver(
  chatId: number,
  interactive: boolean,
): MentionResolver {
  const { data } = useApp();

  // The chat module renders names but does not otherwise guarantee the
  // employee collection is loaded; mirror `EmployeeAvatar`'s best-effort load.
  useEffect(() => {
    appStore.ensureEmployees();
  }, []);

  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const employee of data.employees.items) {
      const name = employee.name.trim();
      if (name.length > 0) map.set(employee.id, name);
    }
    return map;
  }, [data.employees.items]);

  const resolveMention = useCallback(
    (id: number) => nameById.get(id) ?? null,
    [nameById],
  );

  const onMentionClick = useMemo(() => {
    if (!interactive) return undefined;
    return (id: number): void => {
      void appStore.openAgentSession(id, chatId);
    };
  }, [interactive, chatId]);

  return { resolveMention, onMentionClick };
}
