import { useEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
  /** Auto-grow up to `maxHeight`. */
  autosize?: boolean;
  minHeight?: number;
  maxHeight?: number;
}

export function Textarea({
  invalid = false,
  mono = false,
  autosize = false,
  minHeight = 96,
  maxHeight = 160,
  className,
  style,
  onInput,
  ...rest
}: TextareaProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize(): void {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  useEffect(() => {
    if (autosize) {
      resize();
    }
  }, [autosize, rest.value]);

  return (
    <textarea
      ref={ref}
      className={cls(
        "imb-textarea",
        invalid && "imb-is-invalid",
        mono && "imb-mono",
        className,
      )}
      style={{ ...style, minHeight: autosize ? undefined : minHeight }}
      onInput={(e) => {
        onInput?.(e);
        if (autosize) resize();
      }}
      {...rest}
    />
  );
}
