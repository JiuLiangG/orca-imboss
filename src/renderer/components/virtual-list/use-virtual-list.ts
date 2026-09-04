import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

export interface UseVirtualListOptions {
  /** Total number of rows (real items + optional footer row). */
  count: number;
  /** Initial row height guess; rows are re-measured after first paint. */
  estimateSize?: (index: number) => number;
  /** Extra rows rendered above/below the viewport. */
  overscan?: number;
  /** Fixed gap (px) between rows, applied in the virtualizer's layout math. */
  gap?: number;
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
    estimateSize: estimateSize ?? (() => 56),
    overscan,
    gap,
  });
  return { scrollRef, virtualizer };
}
