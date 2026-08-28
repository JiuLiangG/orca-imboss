import type { ButtonHTMLAttributes } from "react";
import "./index.css";

/** Square icon button (attach, close, gear, delete…). */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: number;
  /** Square side length in px (default 32). */
  box?: number;
}

export function IconButton({
  label,
  size = 18,
  box = 32,
  className,
  children,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`imb-icon-btn${className ? ` ${className}` : ""}`}
      style={{ width: box, height: box }}
      aria-label={label}
      title={label}
      {...rest}
    >
      <span className="imb-icon-btn-icon" style={{ width: size, height: size }}>
        {children}
      </span>
    </button>
  );
}
