import { t } from "@shared/l10n";
import type { MessageStep } from "@shared/types";
import { cls } from "reactutils";
import "./index.css";

export interface ProgressCardProps {
  title: string;
  steps: MessageStep[];
}

/** Task progress card (`.progress-card`): title + name·role + status tag. */
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
            {step.status === "done" ? t("Done") : t("In progress")}
          </span>
        </div>
      ))}
    </div>
  );
}
