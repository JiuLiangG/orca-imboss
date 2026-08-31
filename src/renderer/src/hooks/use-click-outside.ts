import { type RefObject, useEffect } from "react";

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
