import { cls } from "reactutils";
import "./index.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible label (also used as the tooltip). */
  label?: string;
}

/** Minimal accessible switch (role="switch") used by the Integrations cards. */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cls("imb-toggle", checked && "imb-is-on")}
      onClick={() => onChange(!checked)}
    >
      <span className="imb-toggle-knob" aria-hidden="true" />
    </button>
  );
}
