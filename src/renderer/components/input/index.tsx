import type { InputHTMLAttributes, RefObject } from "react";
import { cls } from "reactutils";
import { useComposition } from "../../hooks/use-composition";
import "./index.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
  /** Fires when the value is committed — never mid-IME composition. */
  onValueCommit?: (value: string) => void;
  /**
   * The underlying `<input>`, for owners that must focus / select it (the
   * in-thread find bar). `ref` itself is not forwarded.
   */
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function Input({
  invalid = false,
  mono = false,
  className,
  inputRef,
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
      ref={inputRef}
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
