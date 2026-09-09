import type { ButtonHTMLAttributes } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div className="imb-segmented-group" role="group" aria-label={label}>
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

interface SegmentedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

function SegmentedButton({
  active,
  children,
  ...rest
}: SegmentedButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cls("imb-segmented-btn", active && "imb-is-active")}
      aria-pressed={active}
      {...rest}
    >
      {children}
    </button>
  );
}
