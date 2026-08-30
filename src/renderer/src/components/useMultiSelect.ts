import { useCallback, useEffect, useRef, useState } from "react";

export interface ClickModifiers {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export interface UseMultiSelectOptions<T, K> {
  getKey: (item: T, index: number) => K;
  items: readonly T[];
  /** Plain click action — the module's "open detail" behavior. */
  onActivate: (item: T) => void;
  /**
   * Bump to clear the selection + shift anchor (e.g. the list resetVersion,
   * so query changes / refresh / `messages:changed` clear stale keys).
   */
  resetVersion?: number;
}

export interface MultiSelect<T, K> {
  selectedKeys: ReadonlySet<K>;
  isSelected: (key: K) => boolean;
  /**
   * - plain click → `onActivate(item)`, clears the set, re-anchors shift;
   * - ctrl/meta + click → toggles membership (no activate, no re-anchor);
   * - shift + click → adds the contiguous range [anchor..clicked] over loaded
   *   items (anchor = clicked index when none; range adds, never replaces).
   */
  onItemClick: (item: T, index: number, mods: ClickModifiers) => void;
  /** Clear the selection set and the shift anchor. */
  clear: () => void;
  /** Select every currently loaded item. */
  selectAll: () => void;
}

/**
 * Shared interactive multi-select model (cmd/ctrl toggle, shift range).
 * Selection state lives module-side — `ItemList` only renders it — so bulk
 * actions can run from a right-click menu against loaded items.
 */
export function useMultiSelect<T, K>({
  getKey,
  items,
  onActivate,
  resetVersion = 0,
}: UseMultiSelectOptions<T, K>): MultiSelect<T, K> {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<K>>(new Set());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const anchorRef = useRef<{ key: K; index: number } | null>(null);

  useEffect(() => {
    setSelectedKeys(new Set());
    anchorRef.current = null;
  }, [resetVersion]);

  const clear = useCallback((): void => {
    setSelectedKeys(new Set());
    anchorRef.current = null;
  }, []);

  const selectAll = useCallback((): void => {
    setSelectedKeys(
      new Set(
        itemsRef.current.map((item, index) => getKeyRef.current(item, index)),
      ),
    );
  }, []);

  const onItemClick = useCallback(
    (item: T, index: number, mods: ClickModifiers): void => {
      const key = getKeyRef.current(item, index);
      if (mods.shift) {
        setSelectedKeys((current) => {
          const next = new Set(current);
          const anchor = anchorRef.current;
          if (!anchor) {
            anchorRef.current = { key, index };
            next.add(key);
            return next;
          }
          const anchorIndex = itemsRef.current.findIndex(
            (it, i) => getKeyRef.current(it, i) === anchor.key,
          );
          if (anchorIndex < 0) {
            // Anchor no longer loaded (reset without clear?) — fall back to a
            // single-item selection rather than a wild range.
            next.add(key);
            return next;
          }
          const from = Math.min(anchorIndex, index);
          const to = Math.max(anchorIndex, index);
          for (let i = from; i <= to; i += 1) {
            next.add(getKeyRef.current(itemsRef.current[i], i));
          }
          return next;
        });
        return;
      }
      if (mods.ctrl || mods.meta) {
        setSelectedKeys((current) => {
          const next = new Set(current);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
        return;
      }
      // Plain click: activate + clear selection + re-anchor shift.
      setSelectedKeys(new Set());
      anchorRef.current = { key, index };
      onActivateRef.current(item);
    },
    [],
  );

  const isSelected = useCallback(
    (key: K): boolean => selectedKeys.has(key),
    [selectedKeys],
  );

  return { selectedKeys, isSelected, onItemClick, clear, selectAll };
}
