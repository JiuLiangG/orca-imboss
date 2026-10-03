import { t } from "@shared/l10n";
import type { MessageStep, StepStatus } from "@shared/types";
import { cls } from "reactutils";
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
}

export function ProgressCard({
  title,
  steps,
}: ProgressCardProps): React.JSX.Element {
  return (
    <div className="imb-progress-card">
      <div className="imb-progress-card-title">{title}</div>
      {steps.map((step, index) => (
        <div key={`${step.name}-${index}`} className="imb-progress-row">
          <span className="imb-pname">
            {step.name}
            <span className="imb-pname-role"> · {step.role}</span>
          </span>
          <span className={cls("imb-progress-tag", `imb-${step.status}`)}>
            <span className="imb-status-dot" aria-hidden="true" />
            {t(STEP_LABEL_KEYS[step.status] ?? step.status)}
          </span>
        </div>
      ))}
    </div>
  );
}
