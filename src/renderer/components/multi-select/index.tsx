import { t } from "@shared/l10n";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useDropdownPosition } from "../../hooks/use-dropdown-position";
import { useEscapeKey } from "../../hooks/use-escape-key";
import { IconChevronDown, IconSearch, IconX } from "../icons";
import "./index.css";

/** Keep the panel readable even when the trigger is a small inline control. */
const PANEL_MIN_WIDTH = 200;

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  value: string[];
  options: MultiSelectOption[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyHint?: string;
  disabled?: boolean;
  id?: string;
  /** Extra class on the root, e.g. to render a compact trigger. */
  className?: string;
  /** Render a filter input at the top of the panel (substring match on label). */
  searchable?: boolean;
  /** Placeholder of the panel's filter input (only when `searchable`). */
  searchPlaceholder?: string;
  /**
   * When provided (and `searchable`), the panel offers a "Create …" row for
   * text that matches no existing option; called with the trimmed text.
   */
  onSearchCreate?: (text: string) => void;
  /** Cap on the number of selected values; unselected options lock at the cap. */
  maxSelected?: number;
  /**
   * Show a "clear all" control inside the trigger while values are selected.
   * Rendered as a sibling of the trigger button (a button cannot nest another
   * button), so it never toggles the panel.
   */
  clearable?: boolean;
}

/**
 * Multi-select with chips (accent-soft) or muted placeholder, checkbox popup,
 * keyboard navigation (arrows / Home / End, Space toggles) and click-outside
 * close.
 *
 * With `searchable` the panel gains a filter input at the top; arrow keys move
 * a highlight, Enter toggles the highlighted option and (with `onSearchCreate`)
 * a trailing "Create …" row lets the caller add a value that does not exist
 * yet — the base of `TagSelect`.
 */
export function MultiSelect({
  value,
  options,
  onChange,
  placeholder = "",
  emptyHint = "—",
  disabled = false,
  id,
  className,
  searchable = false,
  searchPlaceholder = "",
  onSearchCreate,
  maxSelected,
  clearable = false,
}: MultiSelectProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [filter, setFilter] = useState("");
  const { panelStyle, positionPanel } = useDropdownPosition(
    rootRef,
    PANEL_MIN_WIDTH,
  );

  const selectedSet = new Set(value);
  const selected = options.filter((o) => selectedSet.has(o.value));

  const filterText = filter.trim();
  const filtered =
    searchable && filterText.length > 0
      ? options.filter((o) =>
          o.label.toLowerCase().includes(filterText.toLowerCase()),
        )
      : options;
  const atCap = maxSelected !== undefined && value.length >= maxSelected;
  const canCreate =
    searchable &&
    onSearchCreate !== undefined &&
    filterText.length > 0 &&
    !atCap &&
    !options.some((o) => o.value === filterText || o.label === filterText);
  const rowCount = filtered.length + (canCreate ? 1 : 0);

  // The panel is portaled to `document.body`, so it lives outside `rootRef`;
  // both count as "inside" for click-outside purposes.
  const outsideRefs = useMemo(() => [rootRef, panelRef], []);
  const closePanel = useMemo(
    () => (): void => {
      setOpen(false);
      setFilter("");
    },
    [],
  );
  useClickOutside(outsideRefs, closePanel, open);
  useEscapeKey(closePanel, open);

  // Reposition the portaled panel if the viewport scrolls/resizes while open.
  useEffect(() => {
    if (!open) return;
    const reposition = (): void => positionPanel();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open, positionPanel]);

  function openPanel(): void {
    positionPanel();
    setFilter("");
    setActiveIndex(options.length > 0 ? 0 : -1);
    setOpen(true);
  }

  function toggle(optionValue: string): void {
    if (selectedSet.has(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
      return;
    }
    if (atCap) return;
    onChange([...value, optionValue]);
  }

  function createFromFilter(): void {
    if (!onSearchCreate || !canCreate) return;
    onSearchCreate(filterText);
    setFilter("");
    setActiveIndex(-1);
  }

  function focusOption(index: number): void {
    const el = panelRef.current?.querySelector<HTMLElement>(
      `[data-ms-option="${index}"]`,
    );
    el?.focus();
  }

  function onTriggerKeyDown(event: React.KeyboardEvent): void {
    if (disabled) return;
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openPanel();
      }
      return;
    }
    if (searchable) return; // the filter input owns the panel's keyboard nav
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
  }

  function onSearchKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rowCount > 0) setActiveIndex((i) => (i + 1) % rowCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rowCount > 0) setActiveIndex((i) => (i <= 0 ? rowCount - 1 : i - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(rowCount > 0 ? 0 : -1);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(rowCount - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) {
        toggle(filtered[activeIndex].value);
      } else if (canCreate && activeIndex === filtered.length) {
        createFromFilter();
      }
    }
  }

  const showEmpty = filtered.length === 0 && !canCreate;
  const showClear = clearable && !disabled && value.length > 0;

  return (
    <div
      className={cls(
        "imb-ms",
        className,
        showClear && "imb-ms-has-clear",
      )}
      ref={rootRef}
    >
      <button
        type="button"
        id={id}
        className="imb-ms-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => (open ? closePanel() : openPanel())}
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
      {showClear && (
        <button
          type="button"
          className="imb-ms-clear"
          aria-label={t("Clear")}
          title={t("Clear")}
          onClick={(event) => {
            // Sibling of the trigger: never toggles the panel. Clearing the
            // values is the whole action.
            event.stopPropagation();
            onChange([]);
          }}
        >
          <IconX className="imb-icon imb-sm" />
        </button>
      )}
      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            className="imb-ms-panel"
            role="listbox"
            aria-multiselectable="true"
            style={{
              position: "fixed",
              top: panelStyle.top,
              bottom: panelStyle.bottom,
              left: panelStyle.left,
              width: panelStyle.width,
              maxHeight: panelStyle.maxHeight,
              right: "auto",
              zIndex: 50,
            }}
          >
            {searchable && (
              <div className="imb-ms-search">
                <IconSearch className="imb-icon imb-sm" />
                <input
                  type="text"
                  value={filter}
                  placeholder={searchPlaceholder}
                  autoFocus
                  aria-label={searchPlaceholder || undefined}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                />
              </div>
            )}
            {showEmpty && <div className="imb-ms-empty">{emptyHint}</div>}
            {filtered.map((option, index) => {
              const checked = selectedSet.has(option.value);
              const locked = !checked && atCap;
              return (
                <label
                  key={option.value}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={locked || undefined}
                  className={cls(
                    "imb-ms-option",
                    checked && "imb-is-checked",
                    index === activeIndex && "imb-is-active",
                    locked && "imb-is-locked",
                  )}
                  data-ms-option={index}
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    // Keep focus in the filter input while clicking options.
                    if (searchable) event.preventDefault();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      toggle(option.value);
                      setActiveIndex(index);
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() => toggle(option.value)}
                    tabIndex={searchable ? -1 : index === activeIndex ? 0 : -1}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
            {canCreate && (
              <button
                type="button"
                className={cls(
                  "imb-ms-create",
                  activeIndex === filtered.length && "imb-is-active",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={createFromFilter}
              >
                {t('Create "${name}"', { name: filterText })}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
