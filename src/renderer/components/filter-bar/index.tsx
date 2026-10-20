import { t } from "@shared/l10n";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useDropdownPosition } from "../../hooks/use-dropdown-position";
import { usePopupLayer } from "../../hooks/use-popup-layer";
import { Chip } from "../chip";
import { IconFilter, IconSearch, IconX } from "../icons";
import { MultiSelectPanel, type MultiSelectOption } from "../multi-select";
import "./index.css";

/** Keep the panel readable even when the bar is narrow. */
const PANEL_MIN_WIDTH = 200;

export interface FilterBarProps {
  /** Keyword text (the search field of the merged control). */
  value: string;
  onValueChange: (value: string) => void;
  /** Selected filter values, echoed as chips **under** the box. */
  filters: string[];
  onFiltersChange: (filters: string[]) => void;
  /**
   * Candidate options of the filter panel. Labels are the owner's business
   * (`#tag` for tags, plain text for pseudo-options like "No tags").
   */
  filterOptions: readonly MultiSelectOption[];
  placeholder?: string;
  /** Shortcut hint shown at the right while the keyword is empty (e.g. "⌘K"). */
  hint?: string;
  /** Accessible name + tooltip of the funnel button. */
  filtersLabel: string;
  /** Shown inside the panel when there is no candidate at all. */
  emptyHint?: string;
  /** Cap on the number of filters; unselected options lock at the cap. */
  maxSelected?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** The keyword input, for the owner's global shortcut (⌘K). */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * One search box that also owns the list's tag filter: the keyword input with
 * a funnel button at its right (multi-select tag panel, count badge while
 * filters are active), plus a **non-input** row under the box echoing the
 * active filters as removable chips.
 *
 * Why not two boxes: the search field and the tag trigger used to be two
 * stacked, identically-styled boxes in the 300px list pane — they read as one
 * control broken in two and competed for the same focus ring. Chips were tried
 * *inside* the box first; at ~284px usable width a couple of tags squeezed the
 * keyword field to nothing, so the chips moved out into a plain echo row that
 * only exists while something is filtered. The keyword and the filters stay
 * independent (`value` / `filters` are AND-combined by the owner); only the
 * chrome is merged.
 *
 * Responsibilities are deliberately split: the `×` in the box clears the
 * keyword only (same as a plain search field), the "Clear" button at the end of
 * the chips row clears the tag filters only. Nothing clears both silently.
 *
 * Keyboard (focus never leaves the keyword input while the panel is open):
 * - ⌘K focuses the input (owner-side shortcut),
 * - ↓ opens the panel; ↑/↓/Home/End then move the highlight,
 * - Enter toggles the highlighted option,
 * - Escape dismisses one level per press: panel → keyword → blur.
 *
 * Space types a space instead of toggling the highlighted option: this is a
 * search field, and `MultiSelect`'s searchable panel behaves the same way.
 * Enter is the toggle key.
 */
export function FilterBar({
  value,
  onValueChange,
  filters,
  onFiltersChange,
  filterOptions,
  placeholder = "",
  hint,
  filtersLabel,
  emptyHint = t("No tags yet"),
  maxSelected,
  disabled = false,
  id,
  className,
  inputRef,
}: FilterBarProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const inputEl = inputRef ?? fallbackInputRef;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Stable ids so the input can describe the panel it drives.
  const uid = useId();
  const { panelStyle, positionPanel } = useDropdownPosition(
    rootRef,
    PANEL_MIN_WIDTH,
  );

  const labelByValue = useMemo(
    () => new Map(filterOptions.map((option) => [option.value, option.label])),
    [filterOptions],
  );
  const atCap = maxSelected !== undefined && filters.length >= maxSelected;

  // The panel is portaled to `document.body`, so it lives outside `rootRef`;
  // both count as "inside" for click-outside purposes.
  const outsideRefs = useMemo(() => [rootRef, panelRef], []);
  const closePanel = useMemo(() => (): void => setOpen(false), []);
  useClickOutside(outsideRefs, closePanel, open);
  // Leave Escape / the focus order to this panel while it is open, even when it
  // was opened from inside a `Modal` (its panel is portaled outside the dialog).
  usePopupLayer(open);

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

  // The keyboard highlight lives on the input, not on the rows: keep the
  // highlighted row inside the panel's scroll viewport.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const row = panelRef.current?.querySelector<HTMLElement>(
      `[data-ms-option="${activeIndex}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function chipLabel(filterValue: string): string {
    return (
      labelByValue.get(filterValue) ??
      // A selected value missing from the candidates (tag deleted meanwhile)
      // still renders instead of a blank chip.
      (filterValue.length === 0 ? t("No tags") : `#${filterValue}`)
    );
  }

  function openPanel(): void {
    if (disabled) return;
    positionPanel();
    // Point the highlight at an already-selected row, then the first one.
    const first = filterOptions.findIndex((option) =>
      filters.includes(option.value),
    );
    setActiveIndex(first >= 0 ? first : filterOptions.length > 0 ? 0 : -1);
    setOpen(true);
  }

  function toggle(filterValue: string): void {
    if (disabled) return;
    if (filters.includes(filterValue)) {
      onFiltersChange(filters.filter((v) => v !== filterValue));
      return;
    }
    if (atCap) return;
    onFiltersChange([...filters, filterValue]);
  }

  function moveActive(delta: number): void {
    const count = filterOptions.length;
    if (count === 0) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((index) => {
      if (index < 0) return delta > 0 ? 0 : count - 1;
      return (index + delta + count) % count;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (disabled) return;
    // An IME session owns Enter / Backspace / arrows while it is composing.
    if (event.nativeEvent.isComposing) return;
    // Only gestures that originate in our keyword field: the panel is portaled
    // but still a React child, so its checkbox keydowns bubble up here too.
    const onInput = event.target === inputEl.current;

    // Keyboard focus leaves the control (Tab to the list / next target) → do
    // not leave a panel floating without its field.
    if (event.key === "Tab") {
      if (open) closePanel();
      return;
    }

    if (event.key === "Escape") {
      // Graded dismissal of the box itself: panel → keyword → blur. The chips
      // row is outside this control (and outside its focus chain), so it has
      // no Escape level of its own.
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        closePanel();
        inputEl.current?.focus();
        return;
      }
      if (value.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        onValueChange("");
        return;
      }
      inputEl.current?.blur();
      return;
    }

    // Everything below is a text-field gesture: leave buttons alone.
    if (!onInput) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (open) moveActive(1);
        else openPanel();
        return;
      case "ArrowUp":
        if (!open) return; // arrow up in a one-line field: no-op
        event.preventDefault();
        moveActive(-1);
        return;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(filterOptions.length > 0 ? 0 : -1);
        return;
      case "End":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(filterOptions.length - 1);
        return;
      case "Enter": {
        if (!open) return;
        event.preventDefault();
        const option = filterOptions[activeIndex];
        if (option !== undefined) toggle(option.value);
        return;
      }
      default:
        return;
    }
  }

  const showClear = !disabled && value.length > 0;
  const showBadge = filters.length > 0;
  const filterButtonLabel = showBadge
    ? `${filtersLabel} (${filters.length})`
    : filtersLabel;

  return (
    <div className={cls("imb-filterbar", className)}>
      <div
        ref={rootRef}
        className="imb-filterbar-box"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => {
          // A click on the box itself (not on a button) is a click into the
          // keyword field, like any other input.
          if (event.target === event.currentTarget) {
            event.preventDefault();
            inputEl.current?.focus();
          }
        }}
      >
        <IconSearch className="imb-icon imb-sm" />
        <input
          ref={inputEl}
          id={id}
          type="text"
          className="imb-filterbar-input"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${uid}-listbox` : undefined}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${uid}-opt-${activeIndex}` : undefined
          }
          aria-label={placeholder || undefined}
          autoComplete="off"
          onChange={(event) => onValueChange(event.target.value)}
        />
        <div className="imb-filterbar-actions">
          {showClear && (
            <button
              type="button"
              className="imb-filterbar-clear"
              aria-label={t("Clear")}
              title={t("Clear")}
              onClick={() => {
                onValueChange("");
                inputEl.current?.focus();
              }}
            >
              <IconX className="imb-icon imb-sm" />
            </button>
          )}
          {value.length === 0 && hint !== undefined && (
            <kbd className="imb-filterbar-hint">{hint}</kbd>
          )}
          <button
            type="button"
            className={cls(
              "imb-filterbar-toggle",
              showBadge && "imb-is-active",
              open && "imb-is-open",
            )}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={filterButtonLabel}
            title={filterButtonLabel}
            onClick={() => {
              if (open) {
                closePanel();
                return;
              }
              openPanel();
              // Put the caret in the field so ↑/↓/Enter/typing keep working
              // right away (also when the panel was opened with the keyboard).
              inputEl.current?.focus();
            }}
          >
            <IconFilter className="imb-icon imb-sm" />
            {showBadge && (
              <span className="imb-filterbar-count" aria-hidden="true">
                {filters.length}
              </span>
            )}
          </button>
        </div>
      </div>
      {/* Echo of the active filters — not an input, not focusable as a whole,
          and not rendered at all (zero height) while nothing is filtered. */}
      {showBadge && (
        <div className="imb-filterbar-chips">
          {filters.map((filterValue) => {
            const label = chipLabel(filterValue);
            return (
              <Chip
                key={filterValue}
                title={label}
                removable={!disabled}
                removeLabel={t("Remove ${name}", { name: label })}
                onRemove={() =>
                  onFiltersChange(filters.filter((v) => v !== filterValue))
                }
              >
                <span className="imb-filterbar-chip-label">{label}</span>
              </Chip>
            );
          })}
          <button
            type="button"
            className="imb-filterbar-clear-filters"
            disabled={disabled}
            aria-label={t("Clear filters")}
            title={t("Clear filters")}
            onClick={() => onFiltersChange([])}
          >
            {t("Clear")}
          </button>
        </div>
      )}
      {open &&
        panelStyle &&
        createPortal(
          <MultiSelectPanel
            panelRef={panelRef}
            idPrefix={uid}
            style={{
              top: panelStyle.top,
              bottom: panelStyle.bottom,
              left: panelStyle.left,
              width: panelStyle.width,
              maxHeight: panelStyle.maxHeight,
            }}
            options={filterOptions}
            selected={filters}
            activeIndex={activeIndex}
            onToggle={toggle}
            atCap={atCap}
            emptyMessage={emptyHint}
            focusStaysOutside
          />,
          document.body,
        )}
    </div>
  );
}
