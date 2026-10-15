import type { PageQuery, PageResult } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseInfiniteListOptions {
  /** Server-side filter/search term; changing it resets to page 1. */
  query?: string;
  /** Page size forwarded to the endpoint (default 50). */
  pageSize?: number;
  /**
   * Extra `PageQuery` fields forwarded with every page fetch (e.g. a tag
   * filter). Pair with `paramsKey` so a change resets to page 1.
   */
  params?: Omit<PageQuery, "cursor" | "limit" | "query">;
  /** Reset key for `params`; changing it re-fetches from page 1. */
  paramsKey?: string;
}

export interface InfiniteList<T> {
  /** All loaded items, in server order (pages appended). */
  items: T[];
  hasMore: boolean;
  /** True while the first page is loading (list shows the loading state). */
  loading: boolean;
  /** True while a follow-up page is being fetched. */
  loadingMore: boolean;
  error: string | null;
  /** Fetch the next page (no-op while loading / when exhausted). */
  loadMore: () => Promise<void>;
  /** Clear and reload page 1 (query change, refresh triggers…). */
  reset: () => void;
  /** In-place item mutation (e.g. local unread clear, detail patches). */
  mutate: (updater: (items: T[]) => T[]) => void;
  /** Increments on every reset — pass to `useMultiSelect` to clear selection. */
  resetVersion: number;
}

/**
 * Keyset-paged infinite list. The module owns the instance (the detail pane +
 * auto-select-first need `items`), and `ItemList` stays presentational.
 *
 * - `fetchPage(cursor, limit, query)` must resolve `{ items, nextCursor,
 *   hasMore }` in the module's server order.
 * - Race protection: stale responses (superseded by `reset()`) are ignored.
 * - `loadMore` guards against duplicate in-flight fetches.
 */
export function useInfiniteList<T>(
  fetchPage: (page: PageQuery) => Promise<PageResult<T>>,
  options?: UseInfiniteListOptions,
): InfiniteList<T> {
  const { query = "", pageSize = 50, params, paramsKey = "" } = options ?? {};
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMoreState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);

  // Mirrors of state for synchronous guards inside `loadMore`.
  const hasMoreRef = useRef(false);
  const loadingRef = useRef(true);
  const inFlightRef = useRef(false);
  const cursorRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);

  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const reset = useCallback((): void => {
    requestSeqRef.current += 1;
    inFlightRef.current = false;
    cursorRef.current = null;
    loadingRef.current = true;
    hasMoreRef.current = false;
    setItems([]);
    setError(null);
    setLoading(true);
    setLoadingMore(false);
    setHasMoreState(false);
    setResetToken((token) => token + 1);
  }, []);

  const setHasMore = useCallback((value: boolean): void => {
    hasMoreRef.current = value;
    setHasMoreState(value);
  }, []);

  // First page: initial mount, `query` change, or external `reset()`.
  useEffect(() => {
    const seq = ++requestSeqRef.current;
    let alive = true;
    inFlightRef.current = false;
    cursorRef.current = null;
    loadingRef.current = true;
    setItems([]);
    setError(null);
    setLoading(true);
    setLoadingMore(false);
    hasMoreRef.current = false;
    setHasMoreState(false);

    void (async () => {
      try {
        const needle = query.trim();
        const page = await fetchRef.current({
          limit: pageSize,
          query: needle.length > 0 ? needle : undefined,
          ...paramsRef.current,
        });
        if (!alive || seq !== requestSeqRef.current) return;
        cursorRef.current = page.nextCursor;
        setItems(page.items);
        setHasMore(page.hasMore);
        setError(null);
      } catch (err) {
        if (!alive || seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive && seq === requestSeqRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [query, pageSize, resetToken, paramsKey, setHasMore]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (inFlightRef.current || loadingRef.current || !hasMoreRef.current) {
      return;
    }
    const seq = requestSeqRef.current;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const needle = query.trim();
      const page = await fetchRef.current({
        limit: pageSize,
        cursor: cursorRef.current,
        query: needle.length > 0 ? needle : undefined,
        ...paramsRef.current,
      });
      if (seq !== requestSeqRef.current) return;
      cursorRef.current = page.nextCursor;
      setItems((current) => [...current, ...page.items]);
      setHasMore(page.hasMore);
      setError(null);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === requestSeqRef.current) {
        inFlightRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [query, pageSize, setHasMore]);

  const mutate = useCallback(
    (updater: (items: T[]) => T[]): void => setItems(updater),
    [],
  );

  return {
    items,
    hasMore,
    loading,
    loadingMore,
    error,
    loadMore,
    reset,
    mutate,
    resetVersion: resetToken,
  };
}
