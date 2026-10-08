import {
  useCallback,
  useEffect,
  useRef,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { cls } from "reactutils";
import { useComposition } from "../../hooks/use-composition";
import "./index.css";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
  /** Auto-grow up to `maxHeight`. */
  autosize?: boolean;
  minHeight?: number;
  maxHeight?: number;
  /** Fires when the value is committed — never mid-IME composition. */
  onValueCommit?: (value: string) => void;
  /** Optional external ref to the underlying textarea (merged with autosize). */
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({
  ref,
  invalid = false,
  mono = false,
  autosize = false,
  minHeight = 96,
  maxHeight = 160,
  className,
  style,
  onInput,
  onValueCommit,
  onKeyDown,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: TextareaProps): React.JSX.Element {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  // Merge the autosize ref with any externally supplied ref. Passing the
  // external ref through `...rest` would clobber the autosize ref (it is
  // spread after `ref`), so it is applied here instead.
  const setRef = useCallback(
    (node: HTMLTextAreaElement | null): void => {
      innerRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );
  const composition = useComposition();

  function resize(): void {
    const el = innerRef.current;
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
      ref={setRef}
      className={cls(
        "imb-textarea",
        invalid && "imb-is-invalid",
        mono && "imb-mono",
        className,
      )}
      style={{ ...style, minHeight: autosize ? undefined : minHeight }}
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
      onInput={(e) => {
        onInput?.(e);
        if (autosize) resize();
      }}
      {...rest}
    />
  );
}
