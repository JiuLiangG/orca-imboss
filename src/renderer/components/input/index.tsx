import type { InputHTMLAttributes } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Input({
  invalid = false,
  mono = false,
  className,
  ...rest
}: InputProps): React.JSX.Element {
  return (
    <input
      className={cls(
        "imb-input",
        invalid && "imb-is-invalid",
        mono && "imb-mono",
        className,
      )}
      {...rest}
    />
  );
}
