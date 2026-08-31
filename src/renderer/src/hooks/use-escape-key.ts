import { useEffect } from "react";

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
