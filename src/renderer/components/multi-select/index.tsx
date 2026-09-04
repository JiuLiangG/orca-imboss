import { useRef, useState } from "react";
import { cls } from "reactutils";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useEscapeKey } from "../../hooks/use-escape-key";
import { IconChevronDown } from "../icons";
import "./index.css";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  value: string[];
  options: MultiSelectOption[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Muted message when there are no options at all. */
  emptyHint?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * Multi-select with chips (accent-soft) or muted placeholder, checkbox popup,
 * keyboard navigation (arrows / Home / End, Space toggles) and click-outside
 * close. Panel scrolls at max-height 210 per prototype `.ms`.
 */
export function MultiSelect({
  value,
  options,
  onChange,
  placeholder = "",
  emptyHint = "—",
  disabled = false,
  id,
}: MultiSelectProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedSet = new Set(value);
  const selected = options.filter((o) => selectedSet.has(o.value));

  const toggle = (optionValue: string): void => {
    const next = selectedSet.has(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange(next);
  };

  useClickOutside(rootRef, () => setOpen(false), open);
  useEscapeKey(() => setOpen(false), open);

  const focusOption = (index: number): void => {
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-ms-option="${index}"]`,
    );
    el?.focus();
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent): void => {
    if (disabled) return;
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(
        options.length > 0 ? (activeIndex + 1) % options.length : -1,
      );
      focusOption(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = activeIndex <= 0 ? options.length - 1 : activeIndex - 1;
      setActiveIndex(next);
      focusOption(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      focusOption(options.length - 1);
    }
  };

  return (
    <div className="imb-ms" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="imb-ms-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="imb-ms-value">
          {selected.length === 0 ? (
            <span className="imb-placeholder">{placeholder}</span>
          ) : (
            selected.map((opt) => (
              <span key={opt.value} className="imb-ms-chip">
                {opt.label}
              </span>
            ))
          )}
        </span>
        <IconChevronDown
          className={cls(
            "imb-icon",
            "imb-sm",
            "imb-ms-caret",
            open && "imb-is-open",
          )}
        />
      </button>
      {open && (
        <div
          className="imb-ms-panel"
          role="listbox"
          aria-multiselectable="true"
        >
          {options.length === 0 && (
            <div className="imb-ms-empty">{emptyHint}</div>
          )}
          {options.map((option, index) => {
            const checked = selectedSet.has(option.value);
            return (
              <label
                key={option.value}
                role="option"
                aria-selected={checked}
                className={cls("imb-ms-option", checked && "imb-is-checked")}
                data-ms-option={index}
                tabIndex={-1}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggle(option.value);
                    setActiveIndex(index);
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option.value)}
                  tabIndex={index === activeIndex ? 0 : -1}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
