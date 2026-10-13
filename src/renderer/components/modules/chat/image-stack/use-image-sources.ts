import { useEffect, useState } from "react";

/**
 * Load attachment images as data URLs, one per index (order preserved).
 *
 * Returns `null` for an index whose bytes main could not inline (missing file,
 * oversized, not a previewable image), so the caller can fall back to a file
 * chip. `pending` is true until the current index set has resolved; while
 * pending the caller should render a placeholder rather than treat every entry
 * as failed.
 */
export function useImageSources(
  messageId: number,
  indices: number[],
): { sources: (string | null)[]; pending: boolean } {
  // The index set is stable per message; a joined key lets the effect depend on
  // its contents instead of a fresh array identity each render.
  const key = indices.join(",");
  const [loaded, setLoaded] = useState<{
    key: string;
    sources: (string | null)[];
  } | null>(null);

  useEffect(() => {
    if (key === "") return;
    const ids = key.split(",").map((value) => Number(value));
    let cancelled = false;
    void Promise.all(
      ids.map((index) =>
        imb.messages.attachmentDataUrl(messageId, index).catch(() => null),
      ),
    ).then((sources) => {
      if (!cancelled) setLoaded({ key, sources });
    });
    return () => {
      cancelled = true;
    };
  }, [messageId, key]);

  if (loaded?.key !== key) {
    return { sources: indices.map(() => null), pending: key !== "" };
  }
  return { sources: loaded.sources, pending: false };
}
