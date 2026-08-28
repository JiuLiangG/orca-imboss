import type { InputHTMLAttributes } from "react";
import "./index.css";

/** Single-line text input (`input` field primitive). */
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
  const classes = [
    "imb-input",
    invalid ? "imb-is-invalid" : "",
    mono ? "imb-mono" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <input className={classes} {...rest} />;
}
