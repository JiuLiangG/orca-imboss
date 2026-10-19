/**
 * Global count of open popup layers (select / multi-select / context menu).
 *
 * Every popup renders its panel through a portal into `document.body`, i.e.
 * *outside* the dialog element of an enclosing `Modal`. From the DOM alone the
 * modal therefore cannot tell whether one of those panels is currently on top
 * of it, while the popup expects to own Escape (close the panel, not the
 * dialog) and the keyboard focus order. `usePopupLayer` keeps this counter up
 * to date; `Modal` consults it before acting on Escape / Tab.
 *
 * Mutable module state, like `listPaneRef` in `app-store`, because it is a DOM
 * fact rather than reactive application state.
 */
let openLayers = 0;

/** True while at least one popup panel is open anywhere in the window. */
export function hasOpenPopupLayer(): boolean {
  return openLayers > 0;
}

/**
 * Register an open popup. Returns an idempotent release function: call it when
 * the popup closes (a double call never decrements twice, and the counter can
 * never go negative).
 */
export function pushPopupLayer(): () => void {
  openLayers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openLayers = Math.max(0, openLayers - 1);
  };
}
