import { t } from "@shared/l10n";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useDropdownPosition } from "../../hooks/use-dropdown-position";
import { useEscapeKey } from "../../hooks/use-escape-key";
import { usePopupLayer } from "../../hooks/use-popup-layer";
import { IconChevronDown, IconX } from "../icons";
import { SkillDescriptionTip } from "../skill-description-tip";
import type { Placement } from "../tooltip/position";
import "./index.css";
import { MultiSelectPanel, type MultiSelectOption } from "./panel";

export { MultiSelectPanel };
export type {
  MultiSelectOption,
  MultiSelectPanelCreate,
  MultiSelectPanelProps,
  MultiSelectPanelSearch,
} from "./panel";

/** Keep the panel readable even when the trigger is a small inline control. */
const PANEL_MIN_WIDTH = 200;
const TIP_SHOW_DELAY_MS = 300;
const TIP_HIDE_DELAY_MS = 180;

interface DescriptionTip {
  description: string;
  anchor: HTMLElement;
  placement: Placement;
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
  const tipNodeRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [filter, setFilter] = useState("");
  const [keyNav, setKeyNav] = useState(false);
  const [tip, setTip] = useState<DescriptionTip | null>(null);
  const tipState = useRef<DescriptionTip | null>(null);
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
  const hasDescriptions = options.some(
    (option) => (option.description?.trim() ?? "").length > 0,
  );

  function clearShowTimer(): void {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }

  function clearHideTimer(): void {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function updateTip(next: DescriptionTip | null): void {
    tipState.current = next;
    setTip(next);
  }

  function armShow(
    option: MultiSelectOption,
    anchor: HTMLElement,
    placement: Placement,
  ): void {
    const description = option.description?.trim() ?? "";
    if (description.length === 0) {
      scheduleHide();
      return;
    }
    clearHideTimer();
    const next = { description, anchor, placement };
    const current = tipState.current;
    if (current) {
      clearShowTimer();
      if (
        current.anchor !== anchor ||
        current.description !== description ||
        current.placement !== placement
      ) {
        updateTip(next);
      }
      return;
    }
    clearShowTimer();
    showTimer.current = window.setTimeout(
      () => updateTip(next),
      TIP_SHOW_DELAY_MS,
    );
  }

  function scheduleHide(): void {
    clearShowTimer();
    if (hideTimer.current !== null) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      updateTip(null);
    }, TIP_HIDE_DELAY_MS);
  }

  // The panel and the description card are portaled to `document.body`, so
  // they live outside `rootRef`. All three count as "inside".
  const outsideRefs = useMemo(() => [rootRef, panelRef, tipNodeRef], []);
  const closePanel = useMemo(
    () => (): void => {
      setOpen(false);
      setFilter("");
      setKeyNav(false);
      setTip((current) => {
        const next =
          current && panelRef.current?.contains(current.anchor)
            ? null
            : current;
        tipState.current = next;
        return next;
      });
    },
    [],
  );
  useClickOutside(outsideRefs, closePanel, open);
  useEscapeKey(closePanel, open);
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

  useEffect(() => {
    return () => {
      if (showTimer.current !== null) window.clearTimeout(showTimer.current);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const activeOption = keyNav && open ? filtered[activeIndex] : undefined;
  const activeDescription = activeOption?.description?.trim() ?? "";
  const activeValue = activeOption?.value;

  useEffect(() => {
    if (!keyNav || !open) return;
    if (activeDescription.length === 0 || activeValue === undefined) {
      updateTip(null);
      return;
    }
    const anchor = panelRef.current?.querySelector<HTMLElement>(
      `[data-ms-value="${CSS.escape(activeValue)}"]`,
    );
    if (!anchor) return;
    clearHideTimer();
    clearShowTimer();
    updateTip({ description: activeDescription, anchor, placement: "right" });
    // The helpers only touch refs and setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyNav, open, activeDescription, activeValue]);

  function openPanel(): void {
    positionPanel();
    setFilter("");
    setKeyNav(false);
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
      setKeyNav(true);
      setActiveIndex(
        options.length > 0 ? (activeIndex + 1) % options.length : -1,
      );
      focusOption(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setKeyNav(true);
      const next = activeIndex <= 0 ? options.length - 1 : activeIndex - 1;
      setActiveIndex(next);
      focusOption(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      setKeyNav(true);
      setActiveIndex(0);
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setKeyNav(true);
      setActiveIndex(options.length - 1);
      focusOption(options.length - 1);
    }
  }

  function onSearchKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setKeyNav(true);
      if (rowCount > 0) setActiveIndex((i) => (i + 1) % rowCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setKeyNav(true);
      if (rowCount > 0) setActiveIndex((i) => (i <= 0 ? rowCount - 1 : i - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setKeyNav(true);
      setActiveIndex(rowCount > 0 ? 0 : -1);
    } else if (event.key === "End") {
      event.preventDefault();
      setKeyNav(true);
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

  const showClear = clearable && !disabled && value.length > 0;

  return (
    <div
      className={cls("imb-ms", className, showClear && "imb-ms-has-clear")}
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
            selected.map((opt) => {
              const description = opt.description?.trim() ?? "";
              return (
                <span
                  key={opt.value}
                  className="imb-ms-chip"
                  onMouseEnter={
                    description.length > 0
                      ? (event) => {
                          setKeyNav(false);
                          armShow(opt, event.currentTarget, "top");
                        }
                      : undefined
                  }
                  onMouseLeave={
                    description.length > 0 ? () => scheduleHide() : undefined
                  }
                >
                  {opt.label}
                </span>
              );
            })
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
          <MultiSelectPanel
            panelRef={panelRef}
            style={{
              top: panelStyle.top,
              bottom: panelStyle.bottom,
              left: panelStyle.left,
              width: panelStyle.width,
              maxHeight: panelStyle.maxHeight,
            }}
            options={filtered}
            selected={value}
            activeIndex={activeIndex}
            onToggle={toggle}
            atCap={atCap}
            // A filtered-out list is not the same as an unconfigured one:
            // `emptyHint` talks about the installation, not the query.
            emptyMessage={filterText.length > 0 ? t("No matches") : emptyHint}
            focusStaysOutside={searchable}
            search={
              searchable
                ? {
                    value: filter,
                    placeholder: searchPlaceholder,
                    onChange: (next) => {
                      setFilter(next);
                      setKeyNav(false);
                      setActiveIndex(0);
                    },
                    onKeyDown: onSearchKeyDown,
                  }
                : undefined
            }
            create={
              canCreate
                ? {
                    label: t('Create "${name}"', { name: filterText }),
                    active: activeIndex === filtered.length,
                    onClick: createFromFilter,
                  }
                : undefined
            }
            onOptionPointerEnter={
              hasDescriptions
                ? (option, anchor) => {
                    setKeyNav(false);
                    armShow(option, anchor, "right");
                  }
                : undefined
            }
            onOptionPointerLeave={hasDescriptions ? scheduleHide : undefined}
          />,
          document.body,
        )}
      {tip && (
        <SkillDescriptionTip
          tipRef={tipNodeRef}
          anchor={tip.anchor}
          description={tip.description}
          placement={tip.placement}
          onPointerEnter={clearHideTimer}
          onPointerLeave={scheduleHide}
          onDismiss={() => updateTip(null)}
        />
      )}
    </div>
  );
}
