import type { InputHTMLAttributes } from "react";
import { cls } from "reactutils";
import { useComposition } from "../../hooks/use-composition";
import "./index.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
  /** Fires when the value is committed — never mid-IME composition. */
  onValueCommit?: (value: string) => void;
}

export function Input({
  invalid = false,
  mono = false,
  className,
  onValueCommit,
  onKeyDown,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: InputProps): React.JSX.Element {
  const composition = useComposition();

  return (
    <input
      className={cls(
        "imb-input",
        invalid && "imb-is-invalid",
        mono && "imb-mono",
        className,
      )}
      onKeyDown={(event) => {
        if (composition.isComposing()) return;
        onKeyDown?.(event);
      }}
      onChange={(event) => {
        onChange?.(event);
        const commit = composition.shouldCommit(event.target.value);
        if (onValueCommit && commit) {
          onValueCommit(event.target.value);
        }
      }}
      onCompositionStart={(event) => {
        composition.onCompositionStart();
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        const value = event.currentTarget.value;
        composition.onCompositionEnd(value);
        onValueCommit?.(value);
        onCompositionEnd?.(event);
      }}
      {...rest}
    />
  );
}
