import { type RefObject, useEffect } from "react";

/**
 * Invoke `handler` on any pointerdown outside the referenced element(s).
 * Used by popups (select / multi-select / context menus). Uses the DOM event
 * system deliberately — these popups need document-level detection, which
 * React's synthetic events can't provide from a single element. Multiple refs
 * support a trigger plus a portaled panel that lives outside the trigger.
 */
export function useClickOutside(
  refs:
    RefObject<HTMLElement | null> | readonly RefObject<HTMLElement | null>[],
  handler: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const list = Array.isArray(refs) ? refs : [refs];
    const listener = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      for (const ref of list) {
        const el = ref.current;
        if (el && el.contains(target)) return;
      }
      handler();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [refs, handler, active]);
}
