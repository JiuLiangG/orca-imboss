import { useCallback, useState, type RefObject } from "react";

export interface DropdownPanelStyle {
  /** Viewport-relative offsets; exactly one of `top`/`bottom` is a number. */
  top: number | "auto";
  bottom: number | "auto";
  left: number;
  width: number;
  maxHeight: number;
  /** True when the panel is anchored above its trigger. */
  openUp: boolean;
}

const PANEL_GAP = 6;
const PANEL_MAX_HEIGHT = 210;
const VIEWPORT_MARGIN = 8;

/**
 * Fixed-position a dropdown panel against its trigger, flipping above the
 * trigger when there is more room there and clamping both axes to the
 * viewport so the panel can never be clipped by the window edge.
 *
 * When opened upward the panel is anchored by `bottom` (with `top: auto`) so
 * its far edge grows away from the trigger; this needs no content measurement
 * and therefore no first-frame reposition. The portaled panel must be styled
 * `position: fixed` with the returned offsets.
 */
export function useDropdownPosition(rootRef: RefObject<HTMLElement | null>): {
  panelStyle: DropdownPanelStyle | null;
  positionPanel: () => void;
} {
  const [panelStyle, setPanelStyle] = useState<DropdownPanelStyle | null>(null);

  const positionPanel = useCallback((): void => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const below = viewportH - rect.bottom - PANEL_GAP - VIEWPORT_MARGIN;
    const above = rect.top - PANEL_GAP - VIEWPORT_MARGIN;
    // Flip upward when the space below is tight and above is roomier.
    const openUp = below < PANEL_MAX_HEIGHT && above > below;
    const maxHeight = Math.max(
      0,
      Math.min(PANEL_MAX_HEIGHT, openUp ? above : below),
    );

    const width = Math.min(rect.width, viewportW - 2 * VIEWPORT_MARGIN);
    let left = rect.left;
    if (left + width > viewportW - VIEWPORT_MARGIN) {
      left = viewportW - VIEWPORT_MARGIN - width;
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

    setPanelStyle(
      openUp
        ? {
            top: "auto",
            bottom: viewportH - rect.top + PANEL_GAP,
            left,
            width,
            maxHeight,
            openUp,
          }
        : {
            top: rect.bottom + PANEL_GAP,
            bottom: "auto",
            left,
            width,
            maxHeight,
            openUp,
          },
    );
  }, [rootRef]);

  return { panelStyle, positionPanel };
}
