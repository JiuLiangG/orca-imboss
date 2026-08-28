import { useEffect, useRef, type TextareaHTMLAttributes } from "react";
import "./index.css";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
  /** Auto-grow up to `maxHeight` (default 160, prototype chat input). */
  autosize?: boolean;
  minHeight?: number;
  maxHeight?: number;
}

/** Multi-line input; `autosize` grows with content (chat input bar). */
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

  const resize = (): void => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  useEffect(() => {
    if (autosize) {
      resize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosize, rest.value]);

  const classes = [
    "imb-textarea",
    invalid ? "imb-is-invalid" : "",
    mono ? "imb-mono" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <textarea
      ref={ref}
      className={classes}
      style={{ ...style, minHeight: autosize ? undefined : minHeight }}
      onInput={(e) => {
        onInput?.(e);
        if (autosize) resize();
      }}
      {...rest}
    />
  );
}
