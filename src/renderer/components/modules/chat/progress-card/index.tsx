import { t } from "@shared/l10n";
import type { MessageStep, StepStatus } from "@shared/types";
import { useEffect, useMemo } from "react";
import { cls } from "reactutils";
import { appStore, useApp } from "../../../../app-store";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconOpen } from "../../../icons";
import { HaltButton } from "../halt-button";
import { MessageTime } from "../message-time";
import { useChatSummary } from "../use-chat-summary";
import "./index.css";

/** Translation key per step status; rendered through `t()` for locale switches. */
const STEP_LABEL_KEYS: Record<StepStatus, string> = {
  pending: "Pending",
  busy: "In progress",
  done: "Done",
};

export interface ProgressCardProps {
  title: string;
  steps: MessageStep[];
  /**
   * Task group this card reports on (`null` for cards stored before the link
   * existed). Enables the open-group arrow and turns resolvable step names
   * into links to that employee's agent session in the group.
   */
  groupChatId: number | null;
  /** Exact send time, revealed on hover at the card's bottom-right corner. */
  timeLabel?: string | null;
}

export function ProgressCard({
  title,
  steps,
  groupChatId,
  timeLabel,
}: ProgressCardProps): React.JSX.Element {
  // Summary resolution (shared cache + delete invalidation) is the same as the
  // `chat` card's: `undefined` loading, `null` missing/deleted.
  const summary = useChatSummary(groupChatId);
  const { data } = useApp();

  // The chat module does not otherwise guarantee the employee collection is
  // loaded; mirror `EmployeeAvatar`'s best-effort load so step names can show
  // current names and know which ids still exist.
  useEffect(() => {
    appStore.ensureEmployees();
  }, []);

  const employeeNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const employee of data.employees.items) {
      map.set(employee.id, employee.name);
    }
    return map;
  }, [data.employees.items]);

  // Step links follow the arrow's policy: they need a conversation that
  // actually exists. No link (legacy card), a still-loading summary or a
  // deleted group keep the names static.
  const targetChatId =
    summary === undefined || summary === null ? null : groupChatId;

  return (
    <>
      <div className="imb-progress-card">
        <div className="imb-progress-card-title">{title}</div>
        {summary !== undefined && summary !== null && (
          <button
            type="button"
            className="imb-progress-open"
            aria-label={t("Open group chat")}
            onClick={() => appStore.openChat(summary)}
          >
            <IconOpen />
          </button>
        )}
        {steps.map((step, index) => {
          const employeeId = step.employeeId;
          const currentName =
            employeeId === null ? undefined : employeeNames.get(employeeId);
          // Prefer the employee's current name; fall back to what the card was
          // published with when the id no longer resolves.
          const displayName = currentName?.trim() || step.name;
          return (
            <div key={`${step.name}-${index}`} className="imb-progress-row">
              <span
                className="imb-pname-wrap"
                onClick={() => {
                  if (employeeId != null && targetChatId != null) {
                    void appStore.openAgentSession(employeeId, targetChatId);
                  }
                }}
              >
                {employeeId !== null && (
                  <EmployeeAvatar employeeId={employeeId} size={22} />
                )}
                <span className="imb-pname">
                  {employeeId !== null &&
                  targetChatId !== null &&
                  currentName !== undefined ? (
                    <button type="button" className="imb-pname-link">
                      {displayName}
                    </button>
                  ) : (
                    displayName
                  )}
                  <span className="imb-pname-role"> · {step.role}</span>
                </span>
              </span>
              <span className={cls("imb-progress-tag", `imb-${step.status}`)}>
                <span className="imb-status-dot" aria-hidden="true" />
                {t(STEP_LABEL_KEYS[step.status] ?? step.status)}
              </span>
            </div>
          );
        })}
        <MessageTime label={timeLabel} />
      </div>
      {/* Row sibling of the bubble, gated on the link id so it is present from
          the first render (no width jump while the summary loads). */}
      {groupChatId !== null && <HaltButton chatId={groupChatId} />}
    </>
  );
}
