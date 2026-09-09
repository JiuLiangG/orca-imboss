import type { ReactNode } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}

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
