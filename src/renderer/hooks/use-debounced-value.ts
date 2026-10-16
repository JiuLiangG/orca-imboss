import { useEffect, useState } from "react";

/** Default debounce delay (ms) for the module search boxes. */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * Trailing-only debounce: returns `value`, but only once it has stayed
 * unchanged for `delayMs`. Callers keep the raw value as their controlled
 * input state (so typing stays responsive) and feed the debounced value only
 * to the expensive consumers (client-side filtering, a server-paged search).
 *
 * An empty value is applied immediately rather than debounced: clearing a
 * search is a discrete action (the clear button, Escape, or a programmatic
 * reset such as the chat module's `newChat()`), and leaving a stale filter
 * applied for one debounce window can deselect or hide a just-created row.
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs = SEARCH_DEBOUNCE_MS,
): T {
  const [debounced, setDebounced] = useState(value);

  // `T` is a string in every call site; the cast keeps the hook generic.
  const immediate = (value as unknown) === "";
  const applied = immediate ? value : debounced;

  useEffect(() => {
    if (immediate) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, immediate]);

  return applied;
}
