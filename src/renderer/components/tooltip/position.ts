/**
 * Shared anchor-positioning math for fixed, body-portalled floating elements
 * (the hover `Tooltip` and the interactive `Popover`). Kept dependency-free so
 * both can reuse the same flip + viewport-clamp behaviour.
 */

export type Placement = "top" | "bottom" | "left" | "right";

export const DEFAULT_OFFSET = 8;
const VIEWPORT_MARGIN = 4;

export interface AnchoredPosition {
  top: number;
  left: number;
  placement: Placement;
}

const OPPOSITE: Record<Placement, Placement> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * Anchor the bubble for `side`, centered on the trigger's edge. Returns the
 * un-clamped top/left. Centering is absolute for the cross axis, so it may fall
 * off-screen on the cross axis; the caller clamps.
 */
function basePosition(
  side: Placement,
  trigger: DOMRect,
  bubble: DOMRect,
  offset: number,
): { top: number; left: number } {
  switch (side) {
    case "top":
      return {
        top: trigger.top - offset - bubble.height,
        left: trigger.left + trigger.width / 2 - bubble.width / 2,
      };
    case "bottom":
      return {
        top: trigger.bottom + offset,
        left: trigger.left + trigger.width / 2 - bubble.width / 2,
      };
    case "left":
      return {
        top: trigger.top + trigger.height / 2 - bubble.height / 2,
        left: trigger.left - offset - bubble.width,
      };
    case "right":
      return {
        top: trigger.top + trigger.height / 2 - bubble.height / 2,
        left: trigger.right + offset,
      };
  }
}

/** Resolve the final placement, flipping once if it overflows, then clamping. */
export function computeAnchoredPosition(
  placement: Placement,
  trigger: DOMRect,
  bubble: DOMRect,
  offset: number,
): AnchoredPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const overflow = (pos: { top: number; left: number }): boolean => {
    const topPad = Math.max(
      VIEWPORT_MARGIN - pos.top,
      pos.top + bubble.height + VIEWPORT_MARGIN - vh,
      0,
    );
    const leftPad = Math.max(
      VIEWPORT_MARGIN - pos.left,
      pos.left + bubble.width + VIEWPORT_MARGIN - vw,
      0,
    );
    return topPad + leftPad > 0;
  };

  let side = placement;
  let pos = basePosition(side, trigger, bubble, offset);
  if (overflow(pos)) {
    side = OPPOSITE[side];
    pos = basePosition(side, trigger, bubble, offset);
  }

  return {
    top: Math.max(
      VIEWPORT_MARGIN,
      Math.min(pos.top, vh - bubble.height - VIEWPORT_MARGIN),
    ),
    left: Math.max(
      VIEWPORT_MARGIN,
      Math.min(pos.left, vw - bubble.width - VIEWPORT_MARGIN),
    ),
    placement: side,
  };
}
