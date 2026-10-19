import { useEffect } from "react";
import { pushPopupLayer } from "../popup-layer";

/**
 * Mark a popup (select / multi-select / context menu panel) as open while
 * `active`, so an enclosing `Modal` leaves Escape and the focus order to it
 * (see `popup-layer.ts`). The layer is released when the popup closes or the
 * component unmounts.
 */
export function usePopupLayer(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return pushPopupLayer();
  }, [active]);
}
