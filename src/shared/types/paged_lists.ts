/** One page returned by a keyset/cursor paginated list endpoint. */
export interface PageResult<T> {
  items: T[];
  /** Opaque keyset cursor for the next page; null when there are no more pages. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** Query accepted by `*:listPage` IPC endpoints (all fields optional). */
export interface PageQuery {
  /** Opaque cursor from the previous page's nextCursor. */
  cursor?: string | null;
  /** Page size; default 50 (services clamp to a sane range). */
  limit?: number;
  /** Server-side filter/search term (semantics per module). */
  query?: string;
  /**
   * Server-side tag filter (currently honored by `chats:summariesPage`): the
   * result must carry **every** listed tag (AND). Empty/absent = no tag filter.
   */
  tags?: string[];
}
