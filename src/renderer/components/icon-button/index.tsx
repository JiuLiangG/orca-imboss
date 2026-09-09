import type { ButtonHTMLAttributes } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: number;
  boxSize?: number;
}

export function IconButton({
  label,
  size = 18,
  boxSize = 32,
  className,
  children,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cls("imb-icon-btn", className)}
      style={{ width: boxSize, height: boxSize }}
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
