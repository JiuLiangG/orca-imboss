import type { ReactNode } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface FieldProps {
  label?: ReactNode;
  /** Muted hint below the control. */
  hint?: ReactNode;
  /** Validation error below the control (turns the label error-colored). */
  error?: ReactNode;
  children: ReactNode;
  /** Optional htmlFor when the first control has an id. */
  htmlFor?: string;
  className?: string;
}

/** Form row: label + control + help/error (prototype `.field`). */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: FieldProps): React.JSX.Element {
  return (
    <div className={cls("imb-field", error && "imb-has-error", className)}>
      {label !== undefined && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? (
        <span className="imb-field-error">{error}</span>
      ) : hint ? (
        <span className="imb-field-help">{hint}</span>
      ) : null}
    </div>
  );
}
