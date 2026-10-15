import { useCallback, useEffect, type ReactNode } from "react";
import { cls } from "reactutils";
import "./index.css";
import { useVirtualList } from "./use-virtual-list";

const FOOTER_KEY = "__virtual-list-footer__";

export interface VirtualListProps<T> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => React.Key;
  /**
   * Render one row's content. `ItemList` (selectable mode) owns the row
   * click; this should render the visual row only (e.g. `<ListRow />`).
   */
  renderItem: (item: T, index: number) => ReactNode;
  /** Initial row height guess (rows self-measure afterwards). */
  estimateSize?: (index: number) => number;
  overscan?: number;
  /** Fixed gap (px) between rows. Applied in layout math, not CSS (rows are absolutely positioned). */
  gap?: number;
  /**
   * Extra row rendered after the last item (e.g. a "loading more" sentinel).
   * While present, the row count is `items.length + 1`, which also guarantees
   * there is scrollable space below the last real row.
   */
  footer?: ReactNode;
  /** Invoked when the last real row becomes (nearly) visible. */
  onNearEnd?: () => void;
  className?: string;
}

/**
 * Generic windowed list over an internal scroll container. Renders
 * absolutely positioned, dynamically measured rows (`data-index` +
 * `measureElement`), with the same visual contract as the old `.imb-list`
 * (horizontal `8px` padding moved into each row wrapper so the virtualizer's
 * scroll math stays exact).
 */
export function VirtualList<T>({
  items,
  getItemKey,
  renderItem,
  estimateSize,
  overscan = 5,
  gap,
  footer,
  onNearEnd,
  className,
}: VirtualListProps<T>): React.JSX.Element {
  // Forward a stable per-item key to the virtualizer (keyed by the item's own
  // id, not its position) so its measurement cache stays correct when the list
  // is reordered or swapped. The footer row (index === items.length) uses a
  // constant key. `items` / `getItemKey` are deps so the mapping follows the
  // current list; the returned keys are stable per item, which is what matters.
  const virtualGetItemKey = useCallback(
    (index: number): React.Key =>
      index >= items.length ? FOOTER_KEY : getItemKey(items[index], index),
    [items, getItemKey],
  );

  const { scrollRef, virtualizer } = useVirtualList({
    count: items.length + (footer !== undefined ? 1 : 0),
    estimateSize,
    overscan,
    gap,
    getItemKey: virtualGetItemKey,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  // Lazy loading: fetch the next page when the user scrolls close to the
  // bottom (or when the loaded rows don't fill the viewport — the sentinel is
  // already visible). All re-entry guards live in the caller's `loadMore`.
  useEffect(() => {
    if (footer === undefined || onNearEnd === undefined) return;
    if (lastIndex >= items.length - 1) onNearEnd();
  }, [footer, onNearEnd, lastIndex, items.length]);

  return (
    <div ref={scrollRef} className={cls("imb-vlist", className)}>
      <div
        className="imb-vlist-inner"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => {
          const rowStyle: React.CSSProperties = {
            transform: `translateY(${virtualItem.start}px)`,
          };
          if (virtualItem.index >= items.length) {
            // Footer/sentinel row (e.g. "loading more").
            return (
              <div
                key={FOOTER_KEY}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className="imb-vlist-row imb-vlist-footer-row"
                style={rowStyle}
              >
                {footer}
              </div>
            );
          }
          const item = items[virtualItem.index];
          return (
            <div
              key={getItemKey(item, virtualItem.index)}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className="imb-vlist-row"
              style={rowStyle}
            >
              {renderItem(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
