import type { CSSProperties } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
}

/**
 * macOS capsule segmented control: one tinted track, and a single raised thumb
 * that slides between the equal-width segments.
 *
 * The thumb is one absolutely positioned element whose offset is derived from
 * `--imb-seg-index` / `--imb-seg-count` (set here), so the selection animation
 * is a compositor-only `transform` — no per-segment background cross-fades and
 * no measuring in JS.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>): React.JSX.Element {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      className="imb-segmented-group"
      role="group"
      aria-label={label}
      style={
        {
          "--imb-seg-index": index,
          "--imb-seg-count": Math.max(options.length, 1),
        } as CSSProperties
      }
    >
      <span className="imb-segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <SegmentedButton
          key={option.value}
          active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </SegmentedButton>
      ))}
    </div>
  );
}

interface SegmentedButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function SegmentedButton({
  active,
  onClick,
  children,
}: SegmentedButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cls("imb-segmented-btn", active && "imb-is-active")}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
