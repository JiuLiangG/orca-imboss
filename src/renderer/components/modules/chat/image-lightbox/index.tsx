import { t } from "@shared/l10n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { IconChevronDown, IconX } from "../../../icons";
import "./index.css";

export interface LightboxImage {
  name: string;
  src: string;
}

export interface ImageLightboxProps {
  images: LightboxImage[];
  /** Index of the shown image within `images`. */
  index: number;
  /**
   * Screen rect of the thumbnail this viewer opened from. Drives the open
   * animation, which grows the image out of that box. Omitted (e.g. opened
   * without a thumbnail) the viewer just fades in.
   */
  origin?: DOMRect | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** Duration of the open transform animation (the backdrop fades via CSS). */
const OPEN_MS = 280;

/** Fitted (neutral) state: the picture at `1×`, fully visible and centred. */
interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const FIT: ZoomState = { scale: 1, x: 0, y: 0 };

/**
 * The fitted baseline (`1×`, the picture exactly as the layout fits it).
 * `FIT`, `0`, the Esc step-back and "double-click to reset" all return here —
 * it is the *neutral* scale, not the smallest one.
 */
const FIT_ZOOM = 1;

/**
 * Zoom range. `1×` (FIT) is the layout's fitted size (capped at `90vw × 80vh`);
 * `0.5×` shrinks further so more can be taken in at once; beyond `4×` the picture
 * only pixelates.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

/** Double-click target, and the step for the `+` / `-` keys. */
const DOUBLE_CLICK_ZOOM = 2;
const KEY_ZOOM_FACTOR = 1.25;

/**
 * Wheel → zoom sensitivity. `Math.exp(-delta * k)` makes one mouse notch
 * (~100px) about ±20% and keeps trackpad pinches (many small deltas) smooth.
 */
const WHEEL_ZOOM_SPEED = 0.002;

/** A live pan (one pointer) or pinch (two pointers) gesture. */
type Gesture =
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      kind: "pinch";
      ids: [number, number];
      startDistance: number;
      startScale: number;
      startMidX: number;
      startMidY: number;
      startX: number;
      startY: number;
    };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * True at the neutral framing: `1×` and centred (so a *shrunk* picture is not
 * fitted — Esc steps it back up to `1×` instead of closing).
 */
const isFitted = (zoom: ZoomState): boolean =>
  zoom.scale === FIT_ZOOM && zoom.x === 0 && zoom.y === 0;

/**
 * Full-screen image viewer shared by the in-chat attachment previews
 * (`image-stack/`) and the composer's attachment thumbnails
 * (`chat-input-bar/`). Rendered into `document.body` so it escapes any
 * stacking context.
 *
 * Gestures: the wheel zooms about the pointer (a trackpad pinch arrives as the
 * same wheel path) within `0.5×–4×`, double-click toggles the neutral framing /
 * 2×, `+` `-` `0` zoom in place and reset, and a drag pans the picture at *any*
 * scale — a fitted or shrunk picture can be nudged to a corner, and none of it
 * can ever be moved out of sight. Arrow keys / the on-screen arrows (with the
 * `n / m` counter) step between images — the wheel no longer does. A click on
 * the backdrop closes; Esc undoes a zoom/pan first and closes on the second
 * press. Switching images always resets the framing, so one picture's zoom can
 * never leak into another's.
 */
export function ImageLightbox({
  images,
  index,
  origin,
  onIndexChange,
  onClose,
}: ImageLightboxProps): React.JSX.Element | null {
  const count = images.length;
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [zoom, setZoomState] = useState<ZoomState>(FIT);
  /** Mirrors `zoom` for listeners and gestures (never re-bound per frame). */
  const zoomRef = useRef<ZoomState>(FIT);
  /** A pan/pinch is running (drives the cursor). */
  const [grabbing, setGrabbing] = useState(false);
  /** Live pointers, keyed by `pointerId` (one = pan, two = pinch). */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  const commitZoom = useCallback((next: ZoomState): void => {
    zoomRef.current = next;
    setZoomState(next);
  }, []);

  /**
   * Layout-space centre of the picture, in client coordinates. Read from
   * `offset*` (layout, unaffected by the transform) so it stays correct while
   * the picture is zoomed/panned and while the FLIP open animation runs. The
   * caption sits under the picture, so this is *not* the window centre — the
   * clamp and the zoom anchor must use the picture's own box.
   */
  const imageCenter = useCallback((): { x: number; y: number } | null => {
    const image = imageRef.current;
    const overlay = overlayRef.current;
    if (!image || !overlay) return null;
    const box = overlay.getBoundingClientRect();
    if (image.offsetParent !== overlay) {
      // Defensive: offset* would be relative to something else.
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return {
      x: box.left + image.offsetLeft + image.offsetWidth / 2,
      y: box.top + image.offsetTop + image.offsetHeight / 2,
    };
  }, []);

  /**
   * Clamp a pan offset so the picture can always be dragged (at any scale)
   * without ever being lost:
   *
   * - smaller than the window → it may be nudged anywhere that keeps it *fully
   *   visible*, i.e. up to a corner but never past an edge;
   * - larger than the window → it may be moved as far as it can go while still
   *   covering the window, so no blank gap ever shows through.
   *
   * Both regimes are the same pair of bounds once solved against the picture's
   * own centre (they just swap which one is the minimum), which is also why
   * panning works at 1× — and why a shrunk picture (scale < 1) stays fully
   * visible and yet freely movable: the same formula covers every scale in
   * `[MIN_ZOOM, MAX_ZOOM]`.
   */
  const clampOffset = useCallback(
    (scale: number, x: number, y: number): { x: number; y: number } => {
      const image = imageRef.current;
      const overlay = overlayRef.current;
      const center = imageCenter();
      if (!image || !overlay || !center) return { x, y };
      const box = overlay.getBoundingClientRect();
      const halfWidth = (image.offsetWidth * scale) / 2;
      const halfHeight = (image.offsetHeight * scale) / 2;
      const nearX = halfWidth - (center.x - box.left);
      const farX = overlay.clientWidth - halfWidth - (center.x - box.left);
      const nearY = halfHeight - (center.y - box.top);
      const farY = overlay.clientHeight - halfHeight - (center.y - box.top);
      return {
        x: clamp(x, Math.min(nearX, farX), Math.max(nearX, farX)),
        y: clamp(y, Math.min(nearY, farY), Math.max(nearY, farY)),
      };
    },
    [imageCenter],
  );

  /**
   * Zoom to `nextScale`, keeping whatever sits under `(clientX, clientY)` in
   * place — the picture grows away from the pointer instead of the centre.
   */
  const zoomAt = useCallback(
    (nextScale: number, clientX: number, clientY: number): void => {
      const current = zoomRef.current;
      const scale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(scale - current.scale) < 0.001) return;
      const center = imageCenter();
      if (!center) return;
      const ratio = scale / current.scale;
      const centerX = center.x + current.x;
      const centerY = center.y + current.y;
      const offset = clampOffset(
        scale,
        clientX - (clientX - centerX) * ratio - center.x,
        clientY - (clientY - centerY) * ratio - center.y,
      );
      commitZoom({ scale, ...offset });
    },
    [clampOffset, commitZoom, imageCenter],
  );

  /**
   * Zoom in/out (`+` / `-` keys) anchored on the picture's own centre, so the
   * keyboard zooms in place instead of dragging the picture towards the window
   * centre — which matters once it has been panned.
   */
  const zoomFromCenter = useCallback(
    (nextScale: number): void => {
      const center = imageCenter();
      if (!center) return;
      const current = zoomRef.current;
      zoomAt(nextScale, center.x + current.x, center.y + current.y);
    },
    [imageCenter, zoomAt],
  );

  const resetZoom = useCallback((): void => {
    if (isFitted(zoomRef.current)) return;
    commitZoom(FIT);
  }, [commitZoom]);

  /**
   * Show another image *and* fit it. The reset happens in the same update as
   * the index change (both are batched), so the arriving picture never paints
   * for one frame with the previous picture's framing.
   */
  const goTo = useCallback(
    (next: number): void => {
      commitZoom(FIT);
      onIndexChange(next);
    },
    [commitZoom, onIndexChange],
  );

  // Opening focuses the close button so Esc/Enter work without a mouse.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // A new picture starts fitted. `goTo` already does this; this effect is the
  // guard for an index changed from outside (the parent clamping a stale one).
  useEffect(() => {
    resetZoom();
  }, [index, resetZoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        // While panned or zoomed, Esc steps back to the fitted framing first (a
        // second press closes); the ✕ and the backdrop still dismiss in one
        // step.
        if (!isFitted(zoomRef.current)) resetZoom();
        else onClose();
      } else if (count > 1 && event.key === "ArrowLeft") {
        event.stopPropagation();
        goTo((index - 1 + count) % count);
      } else if (count > 1 && event.key === "ArrowRight") {
        event.stopPropagation();
        goTo((index + 1) % count);
      } else if (event.key === "+" || event.key === "=") {
        event.stopPropagation();
        zoomFromCenter(zoomRef.current.scale * KEY_ZOOM_FACTOR);
      } else if (event.key === "-" || event.key === "_") {
        event.stopPropagation();
        zoomFromCenter(zoomRef.current.scale / KEY_ZOOM_FACTOR);
      } else if (event.key === "0") {
        event.stopPropagation();
        resetZoom();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [count, index, goTo, onClose, resetZoom, zoomFromCenter]);

  // Wheel: a plain wheel zooms about the pointer at any scale — no modifier
  // needed. A trackpad pinch arrives as `wheel` with `ctrlKey` set, so it takes
  // the exact same path. The listener is native (React's is passive) so the
  // gesture can be owned outright: no page zoom, no scroll behind the viewer.
  // Switching images is deliberately *not* on the wheel: ←/→, the on-screen
  // arrows and the `n / m` counter are the (always visible) ways to flip.
  useEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const delta = event.deltaY * unit;
      event.preventDefault();
      if (delta === 0) return;
      zoomAt(
        zoomRef.current.scale * Math.exp(-delta * WHEEL_ZOOM_SPEED),
        event.clientX,
        event.clientY,
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // FLIP the image out of the thumbnail: place it at the thumbnail's box for
  // the first paint, then release it to its natural size on the next frame so
  // the transform transitions. Zoom/pan live on the wrapper, so they never
  // fight this animation.
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image || !origin) return;
    if (!image.complete || image.naturalWidth === 0) return;
    const target = image.getBoundingClientRect();
    if (target.width === 0 || target.height === 0) return;
    const scale = origin.width / target.width;
    const dx =
      origin.left + origin.width / 2 - (target.left + target.width / 2);
    const dy =
      origin.top + origin.height / 2 - (target.top + target.height / 2);
    image.style.transition = "none";
    image.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    const frame = requestAnimationFrame(() => {
      image.style.transition = `transform ${OPEN_MS}ms var(--imb-ease-standard)`;
      image.style.transform = "translate(0, 0) scale(1)";
    });
    return () => cancelAnimationFrame(frame);
  }, [origin]);

  const capturePointer = (element: HTMLElement, pointerId: number): void => {
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }
  };

  const onZoomPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size > 2) return;
    capturePointer(event.currentTarget, event.pointerId);
    if (pointers.current.size === 1) {
      // One pointer pans the picture at *any* scale (a fitted picture can be
      // nudged to a corner too); a second pointer turns the gesture into a
      // pinch.
      gesture.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: zoomRef.current.x,
        originY: zoomRef.current.y,
      };
      setGrabbing(true);
      return;
    }
    const ids = Array.from(pointers.current.keys()).slice(0, 2) as [
      number,
      number,
    ];
    const [a, b] = ids.map((pointerId) => pointers.current.get(pointerId));
    if (!a || !b) return;
    gesture.current = {
      kind: "pinch",
      ids,
      startDistance: Math.hypot(a.x - b.x, a.y - b.y),
      startScale: zoomRef.current.scale,
      startMidX: (a.x + b.x) / 2,
      startMidY: (a.y + b.y) / 2,
      startX: zoomRef.current.x,
      startY: zoomRef.current.y,
    };
    setGrabbing(true);
  };

  const onZoomPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const tracked = pointers.current.get(event.pointerId);
    if (!tracked) return;
    tracked.x = event.clientX;
    tracked.y = event.clientY;
    const current = gesture.current;
    if (!current) return;
    if (current.kind === "pan") {
      if (!pointers.current.has(current.pointerId)) return;
      const offset = clampOffset(
        zoomRef.current.scale,
        current.originX + (event.clientX - current.startX),
        current.originY + (event.clientY - current.startY),
      );
      commitZoom({ scale: zoomRef.current.scale, ...offset });
      return;
    }
    const [a, b] = current.ids.map((pointerId) =>
      pointers.current.get(pointerId),
    );
    if (!a || !b || current.startDistance <= 0) return;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const scale = clamp(
      (current.startScale * distance) / current.startDistance,
      MIN_ZOOM,
      MAX_ZOOM,
    );
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const center = imageCenter();
    if (!center) return;
    // Keep the picture under the fingers: the pinch also follows the midpoint.
    const ratio = scale / current.startScale;
    const offset = clampOffset(
      scale,
      midX - (current.startMidX - center.x - current.startX) * ratio - center.x,
      midY - (current.startMidY - center.y - current.startY) * ratio - center.y,
    );
    commitZoom({ scale, ...offset });
  };

  const onZoomPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setGrabbing(false);
      return;
    }
    // Pinch → pan: the remaining finger keeps moving the picture, so lifting
    // one finger never makes it jump back to the centred framing.
    if (pointers.current.size === 1) {
      const [pointerId, point] = Array.from(pointers.current.entries())[0];
      gesture.current = {
        kind: "pan",
        pointerId,
        startX: point.x,
        startY: point.y,
        originX: zoomRef.current.x,
        originY: zoomRef.current.y,
      };
      return;
    }
    gesture.current = null;
  };

  const onZoomDoubleClick = (event: {
    clientX: number;
    clientY: number;
  }): void => {
    // Double-click toggles between the neutral framing and 2×: any state that
    // is not fitted (zoomed out to 0.5×, zoomed in, or merely panned) resets
    // first. Jumping 0.5× → 2× directly would be a 4× leap and skip the state
    // the boss most likely wants to get back to.
    if (!isFitted(zoomRef.current)) resetZoom();
    else zoomAt(DOUBLE_CLICK_ZOOM, event.clientX, event.clientY);
  };

  const current = images[index];
  if (!current) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="imb-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        ref={closeRef}
        className="imb-lightbox-close"
        onClick={onClose}
        aria-label={t("Close")}
        title={t("Close")}
      >
        <IconX />
      </button>

      {count > 1 && (
        <button
          type="button"
          className="imb-lightbox-nav imb-lightbox-prev"
          onClick={() => goTo((index - 1 + count) % count)}
          aria-label={t("Previous image")}
          title={t("Previous image")}
        >
          <IconChevronDown />
        </button>
      )}

      <figure className="imb-lightbox-figure">
        <div
          className={cls(
            "imb-lightbox-zoom",
            grabbing && "imb-lightbox-grabbing",
          )}
          style={{
            transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`,
          }}
          onPointerDown={onZoomPointerDown}
          onPointerMove={onZoomPointerMove}
          onPointerUp={onZoomPointerEnd}
          onPointerCancel={onZoomPointerEnd}
          onDoubleClick={onZoomDoubleClick}
        >
          <img
            key={index}
            ref={imageRef}
            className="imb-lightbox-image"
            src={current.src}
            alt={current.name}
            draggable={false}
          />
        </div>
        <figcaption className="imb-lightbox-caption">
          <span className="imb-lightbox-name">{current.name}</span>
          {count > 1 && (
            <span className="imb-lightbox-count">{`${index + 1} / ${count}`}</span>
          )}
        </figcaption>
      </figure>

      {count > 1 && (
        <button
          type="button"
          className="imb-lightbox-nav imb-lightbox-next"
          onClick={() => goTo((index + 1) % count)}
          aria-label={t("Next image")}
          title={t("Next image")}
        >
          <IconChevronDown />
        </button>
      )}
    </div>,
    document.body,
  );
}
