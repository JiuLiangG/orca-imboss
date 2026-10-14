import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  icon?: ReactNode;
  loading?: boolean;
  /** Full-width inside its parent (used by pane footers). */
  block?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  block = false,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={cls(
        "imb-btn",
        `imb-btn-${variant}`,
        size === "sm" && "imb-btn-sm",
        block && "imb-btn-block",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="imb-btn-spinner" aria-hidden="true" />
      ) : (
        icon != null && <span className="imb-btn-leading-icon">{icon}</span>
      )}
      {children}
    </button>
  );
}
