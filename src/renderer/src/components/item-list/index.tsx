import type { ReactNode } from "react";
import { t } from "../../../../shared/libs/l10n";
import type { ClickModifiers } from "../../hooks/use-multi-select";
import { EmptyState } from "../empty-state";
import { VirtualList } from "../virtual-list";
import "./index.css";

export interface ItemListRenderContext {
  selected: boolean;
  index: number;
}

export interface ItemListProps<T, K extends React.Key> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => K;
  /**
   * Row content. For selectable lists `ItemList` owns the row click (see
   * `onItemClick`); `renderItem` only renders visuals + `selected` highlight.
   */
  renderItem: (item: T, ctx: ItemListRenderContext) => ReactNode;
  /** Initial page loading (shows the loading state instead of the list). */
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  loadMore?: () => void;
  emptyMessage?: ReactNode;
  loadingMessage?: ReactNode;
  loadError?: string | null;
  /** Initial row height guess (rows self-measure afterwards). */
  estimateSize?: (index: number) => number;
  /**
   * Interactive multi-select mode: rows forward clicks (with modifiers) to
   * `onItemClick`; each item gets a `selected` context. Requires
   * `selectedKeys` + `onItemClick`.
   */
  selectable?: boolean;
  selectedKeys?: ReadonlySet<K>;
  onItemClick?: (item: T, index: number, mods: ClickModifiers) => void;
}

/**
 * Presentational list pane body: virtualized windowed rows, empty/loading
 * states and a bottom "loading more" sentinel. Data-flow is module-owned
 * (`useInfiniteList` + `useMultiSelect`); this component only renders.
 */
export function ItemList<T, K extends React.Key>({
  items,
  getItemKey,
  renderItem,
  loading = false,
  loadingMore = false,
  hasMore = false,
  loadMore,
  emptyMessage,
  loadingMessage,
  loadError,
  estimateSize,
  selectable = false,
  selectedKeys,
  onItemClick,
}: ItemListProps<T, K>): React.JSX.Element {
  if (loading) {
    return <EmptyState>{loadingMessage ?? t("Loading…")}</EmptyState>;
  }
  if (loadError !== null && items.length === 0) {
    return <EmptyState>{loadError}</EmptyState>;
  }
  if (items.length === 0) {
    return <EmptyState>{emptyMessage}</EmptyState>;
  }

  return (
    <VirtualList<T>
      items={items}
      getItemKey={getItemKey}
      estimateSize={estimateSize}
      footer={
        hasMore ? (
          <span className="imb-item-list-hint">
            {loadingMore ? t("Loading more…") : "\u00a0"}
          </span>
        ) : undefined
      }
      onNearEnd={loadMore}
      renderItem={(item, index) => (
        <div
          className="imb-item-list-row"
          onClick={
            selectable
              ? (event): void => {
                  onItemClick?.(item, index, {
                    ctrl: event.ctrlKey,
                    meta: event.metaKey,
                    shift: event.shiftKey,
                  });
                }
              : undefined
          }
        >
          {renderItem(item, {
            selected: selectable
              ? (selectedKeys?.has(getItemKey(item, index)) ?? false)
              : false,
            index,
          })}
        </div>
      )}
    />
  );
}
