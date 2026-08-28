import { useEffect, type RefObject } from "react";

/**
 * Invoke `handler` on any pointerdown outside the referenced element.
 * Used by popups (select / multi-select / context menus). Uses the DOM event
 * system deliberately — these popups need document-level detection, which
 * React's synthetic events can't provide from a single element.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const listener = (event: MouseEvent): void => {
      const el = ref.current;
      if (!el) return;
      const target = event.target as Node | null;
      if (target && el.contains(target)) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, handler, active]);
}

/** Close on Escape while `active` (popups, menus). */
export function useEscapeKey(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        handler();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [handler, active]);
}

/** Trap Tab focus inside a dialog element. */
export function trapFocus(
  container: HTMLElement | null,
  event: KeyboardEvent,
): void {
  if (!container) return;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const current = document.activeElement;
  if (event.shiftKey && (current === first || !container.contains(current))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && current === last) {
    event.preventDefault();
    first.focus();
  }
}
