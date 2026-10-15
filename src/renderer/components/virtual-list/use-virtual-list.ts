import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type Key } from "react";

/**
 * Initial row height guess when no caller-supplied `estimateSize` is given.
 * Hoisted to a module constant so the option keeps a stable identity across
 * renders (a fresh `() => 56` every render would churn the virtualizer).
 */
const defaultEstimateSize = (): number => 56;

/**
 * Default item key: the row index, matching `@tanstack/react-virtual`'s own
 * `defaultKeyExtractor`. Callers that can supply a stable per-item key should
 * (see `getItemKey` below) so measurements survive reordering / list swaps.
 */
const defaultIndexKey = (index: number): Key => index;

export interface UseVirtualListOptions {
  /** Total number of rows (real items + optional footer row). */
  count: number;
  /** Initial row height guess; rows are re-measured after first paint. */
  estimateSize?: (index: number) => number;
  /** Extra rows rendered above/below the viewport. */
  overscan?: number;
  /** Fixed gap (px) between rows, applied in the virtualizer's layout math. */
  gap?: number;
  /**
   * Stable key for the row at `index` (e.g. the item's id). Forwarded to the
   * virtualizer so its size/measurement caches are keyed by item identity
   * rather than by position — otherwise a reordered or swapped list keeps
   * stale per-index heights and rows overlap. When omitted, rows are keyed by
   * index (the previous behaviour). The callback must be stable (memoize it)
   * to avoid needless recomputation.
   */
  getItemKey?: (index: number) => Key;
}

/**
 * Thin wrapper around `useVirtualizer` bound to a local scroll container.
 * The returned `scrollRef` must be attached to the element with
 * `overflow-y: auto`; `virtualizer.measureElement` (with `data-index`) is
 * attached per row for dynamic height measurement (`.imb-list-row` is
 * variable-height: 1 or 2 lines depending on sub/badge).
 */
export function useVirtualList({
  count,
  estimateSize,
  overscan = 5,
  gap = 0,
  getItemKey,
}: UseVirtualListOptions): {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  virtualizer: ReturnType<
    typeof useVirtualizer<HTMLDivElement, HTMLDivElement>
  >;
} {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateSize ?? defaultEstimateSize,
    overscan,
    gap,
    getItemKey: getItemKey ?? defaultIndexKey,
  });
  return { scrollRef, virtualizer };
}
