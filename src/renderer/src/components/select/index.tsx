import { useId, useRef, useState } from "react";
import { useClickOutside, useEscapeKey } from "../../hooks";
import { IconChevronDown } from "../icons";
import "./index.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
}

/**
 * Custom combobox (prototype used a native select; upgraded to a custom one
 * for keyboard/ARIA parity with the rest of the form controls).
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = "",
  invalid = false,
  disabled = false,
  id,
  label,
}: SelectProps): React.JSX.Element {
  const uid = useId();
  const listboxId = `select-${uid}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Type-ahead buffer.
  const bufferRef = useRef("");
  const bufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openPanel = (): void => {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };
  const closePanel = (): void => {
    setOpen(false);
    setActiveIndex(-1);
  };
  const commit = (index: number): void => {
    if (index < 0 || index >= options.length) return;
    onChange(options[index].value);
    closePanel();
  };

  useClickOutside(rootRef, closePanel, open);
  useEscapeKey(closePanel, open);

  const onTriggerKeyDown = (event: React.KeyboardEvent): void => {
    if (disabled) return;
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openPanel();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "Tab":
        closePanel();
        break;
      default: {
        if (event.key.length === 1 && /[A-Za-z0-9]/.test(event.key)) {
          bufferRef.current += event.key.toLowerCase();
          if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
          bufferTimerRef.current = setTimeout(() => {
            bufferRef.current = "";
          }, 500);
          const match = options.findIndex((o) =>
            o.label.toLowerCase().startsWith(bufferRef.current),
          );
          if (match >= 0) setActiveIndex(match);
        }
      }
    }
  };

  const optionId = (index: number): string => `${listboxId}-opt-${index}`;

  return (
    <div className={`imb-select-wrap${invalid ? " imb-has-error" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="imb-select"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        aria-invalid={invalid || undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? closePanel() : openPanel())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={`imb-select-value${selected ? "" : " imb-is-placeholder"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <IconChevronDown
          className={`imb-icon imb-sm imb-select-caret${open ? " imb-is-open" : ""}`}
        />
      </button>
      {open && (
        <ul className="imb-select-panel" id={listboxId} role="listbox">
          {options.length === 0 && (
            <li className="imb-select-empty" role="presentation">
              —
            </li>
          )}
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              className={`imb-select-option${index === activeIndex ? " imb-is-active" : ""}${option.value === value ? " imb-is-selected" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              <span className="imb-select-option-label">{option.label}</span>
              {option.value === value && (
                <span className="imb-select-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
