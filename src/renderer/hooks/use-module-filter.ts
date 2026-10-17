import { useCallback, useMemo } from "react";
import {
  appStore,
  useAppSync,
  type FilterModule,
  type ModuleFilterState,
} from "../app-store";

export interface ModuleFilter extends ModuleFilterState {
  /** Replace the search-box text (raw, undebounced). */
  setQuery: (next: string) => void;
  /** Replace the whole tag filter. */
  setTags: (next: string[]) => void;
}

/**
 * Search-box text + tag filter of one module's list pane, stored on the
 * `appStore` instead of component state.
 *
 * Modules are unmounted when another module is opened (`App.tsx` renders only
 * the active one), so filter state kept in `useState` used to be lost on every
 * module switch. The store copy is session-only: a switch restores the filters,
 * an app restart starts clean (like the selected row, the thread scroll and the
 * composer drafts).
 *
 * Reading goes through `useAppSync()` (`valtio`'s `sync: true` snapshot) because
 * `SearchInput` is a controlled input whose value must follow the store within
 * the same tick, or the caret jumps. Writing assigns the store field directly,
 * so the store stays the single source of truth (e.g. `appStore.focusChat()`
 * clearing the chat filter immediately affects an already-mounted ChatModule).
 *
 * Only the caller's own `filters[module]` slice is read, so typing in one
 * module does not re-render anything else.
 */
export function useModuleFilter(module: FilterModule): ModuleFilter {
  const snap = useAppSync();
  const filter = snap.filters[module];

  // The valtio snapshot is deeply readonly; the UI wants plain mutable arrays
  // (TagSelect/MultiSelect props). Copy once per actual change so the returned
  // array stays referentially stable across unrelated re-renders.
  const tags = useMemo((): string[] => [...filter.tags], [filter.tags]);

  const setQuery = useCallback(
    (next: string): void => {
      appStore.filters[module].query = next;
    },
    [module],
  );

  const setTags = useCallback(
    (next: string[]): void => {
      // Copy: callers pass arrays they own (a MultiSelect value may be the
      // store's own array proxy), and the store must not alias them.
      appStore.filters[module].tags = [...next];
    },
    [module],
  );

  return { query: filter.query, tags, setQuery, setTags };
}
