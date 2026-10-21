import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from "react";
import { cls } from "reactutils";
import { IconSearch } from "../icons";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/** Panel-top filter input (`searchable` mode); the caller owns its state. */
export interface MultiSelectPanelSearch {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** Trailing "Create …" row offered for text that matches no existing option. */
export interface MultiSelectPanelCreate {
  label: string;
  /** Rendered highlighted (the keyboard highlight sits on the create row). */
  active: boolean;
  onClick: () => void;
}

export interface MultiSelectPanelProps {
  options: readonly MultiSelectOption[];
  /** Selected values; rendered as checked options. */
  selected: readonly string[];
  activeIndex: number;
  onToggle: (value: string) => void;
  /** Unselected options lock at the cap (`maxSelected` reached). */
  atCap?: boolean;
  /** Shown instead of the list when there is nothing to offer. */
  emptyMessage?: ReactNode;
  /**
   * Keep the focus on the caller's own control instead of moving it into the
   * options: every option gets `tabIndex={-1}` and a click never steals focus
   * (the searchable variant, where the filter input owns the keyboard — and
   * `FilterBar`, whose keyword input stays focused while the panel is open).
   */
  focusStaysOutside?: boolean;
  /** Fixed-position offsets from `useDropdownPosition` (the panel is portaled). */
  style?: CSSProperties;
  className?: string;
  /** When set, the listbox and its options get stable ids for `aria-*`. */
  idPrefix?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  search?: MultiSelectPanelSearch;
  create?: MultiSelectPanelCreate;
}

/**
 * The panel body shared by `MultiSelect` (dropdown trigger) and `FilterBar`
 * (tag chips inline in the search box): checkbox options plus the keyboard
 * highlight, an optional filter input and an optional "Create …" row.
 *
 * Positioning, the portal, the open state and the keyboard highlight are the
 * caller's job — this component only renders the list and reports toggles.
 */
export function MultiSelectPanel({
  options,
  selected,
  activeIndex,
  onToggle,
  atCap = false,
  emptyMessage,
  focusStaysOutside = false,
  style,
  className,
  idPrefix,
  panelRef,
  search,
  create,
}: MultiSelectPanelProps): React.JSX.Element {
  const selectedSet = new Set(selected);
  const showEmpty = options.length === 0 && create === undefined;

  return (
    <div
      ref={panelRef}
      id={idPrefix !== undefined ? `${idPrefix}-listbox` : undefined}
      className={cls("imb-ms-panel imb-menu-surface", className)}
      role="listbox"
      aria-multiselectable="true"
      style={{ position: "fixed", right: "auto", zIndex: 50, ...style }}
    >
      {search !== undefined && (
        <div className="imb-ms-search">
          <IconSearch className="imb-icon imb-sm" />
          <input
            type="text"
            value={search.value}
            placeholder={search.placeholder}
            autoFocus
            aria-label={search.placeholder || undefined}
            onChange={(event) => search.onChange(event.target.value)}
            onKeyDown={search.onKeyDown}
          />
        </div>
      )}
      {showEmpty && <div className="imb-ms-empty">{emptyMessage}</div>}
      {options.map((option, index) => {
        const checked = selectedSet.has(option.value);
        const locked = !checked && atCap;
        // Roving tab stop on the checkbox of the highlighted row (the label
        // itself is never a tab stop), unless the caller keeps the focus.
        const checkboxTabIndex = focusStaysOutside
          ? -1
          : index === activeIndex
            ? 0
            : -1;
        return (
          <label
            key={option.value}
            id={idPrefix !== undefined ? `${idPrefix}-opt-${index}` : undefined}
            role="option"
            aria-selected={checked}
            aria-disabled={locked || undefined}
            className={cls(
              "imb-ms-option imb-menu-row",
              checked && "imb-is-checked",
              index === activeIndex && "imb-is-active",
              locked && "imb-is-locked",
            )}
            data-ms-option={index}
            tabIndex={-1}
            onMouseDown={(event) => {
              // Keep focus in the caller's own control (filter input / trigger)
              // while clicking options.
              if (focusStaysOutside) event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onToggle(option.value);
              }
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={locked}
              onChange={() => onToggle(option.value)}
              tabIndex={checkboxTabIndex}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
      {create !== undefined && (
        <button
          type="button"
          className={cls("imb-ms-create", create.active && "imb-is-active")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={create.onClick}
        >
          {create.label}
        </button>
      )}
    </div>
  );
}
