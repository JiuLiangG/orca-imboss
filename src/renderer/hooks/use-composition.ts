import { useCallback, useRef } from "react";

/**
 * Track IME composition for a single editable field. Internal helper for the
 * base `Input`/`Textarea` components — not a general-purpose public hook.
 *
 * `shouldCommit` de-duplicates the change event that some browsers fire right
 * after `compositionend`: the value committed on composition end is remembered
 * until the next value that differs, so no commit is ever missed.
 */
export interface CompositionTracker {
  isComposing: () => boolean;
  onCompositionStart: () => void;
  onCompositionEnd: (value: string) => void;
  shouldCommit: (value: string) => boolean;
}

export function useComposition(): CompositionTracker {
  const composingRef = useRef(false);
  // Value already reported when the composition ended, awaiting a possible
  // trailing change event with the same value.
  const committedRef = useRef<string | null>(null);

  const isComposing = useCallback((): boolean => composingRef.current, []);

  const onCompositionStart = useCallback((): void => {
    composingRef.current = true;
    committedRef.current = null;
  }, []);

  const onCompositionEnd = useCallback((value: string): void => {
    composingRef.current = false;
    committedRef.current = value;
  }, []);

  const shouldCommit = useCallback((value: string): boolean => {
    const committed = committedRef.current;
    if (committed !== null) {
      committedRef.current = null;
      if (committed === value) return false;
    }
    return !composingRef.current;
  }, []);

  return { isComposing, onCompositionStart, onCompositionEnd, shouldCommit };
}
