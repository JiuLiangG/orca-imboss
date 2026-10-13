import { t } from "@shared/l10n";
import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { cls } from "reactutils";
import { useWheelStep } from "../../../../hooks/use-wheel-step";
import { IconOpen } from "../../../icons";
import { ImageLightbox } from "../image-lightbox";
import "./index.css";

export interface ImageStackImage {
  /** Attachment index within the message; also the stable React key. */
  index: number;
  name: string;
  /** Inline `data:` URL resolved by main. */
  src: string;
}

/**
 * Master switch for in-chat image previews (thumbnail, card stack, viewer).
 *
 * The whole feature is self-contained under `image-stack/` +
 * `image-lightbox/` + the `messages:attachmentDataUrl` IPC; this constant is
 * its single integration point in the message bubble, so it can be introduced
 * in whichever form suits the project:
 *
 * - leave it `true` to ship the feature on;
 * - set it `false` to fall back to the plain file chip (the behaviour before
 *   the feature — nothing else needs to change);
 * - replace it with a stored setting read (`SettingKeys` + `imb.settings`) to
 *   expose it as a user option, e.g. `getSetting(SettingKeys.X) !== "off"`;
 * - or drop the commit to leave no trace.
 */
export const IMAGE_PREVIEW_ENABLED = true;

export interface ImageStackProps {
  images: ImageStackImage[];
  /** Message side; the deck leans away from the bubble's outer edge. */
  self: boolean;
}

/** Pointer travel (px) past which a drag counts as "swipe to next". */
const SWIPE_THRESHOLD = 60;

/**
 * Visual layer for each card behind the front one: the deck fans upward, with
 * alternating tilt and shrinking scale so the stack reads as depth.
 */
const CARD_LAYERS = [
  { x: 0, y: 0, rotate: 0, scale: 1 },
  { x: 5, y: -14, rotate: -4, scale: 0.95 },
  { x: -5, y: -28, rotate: 4, scale: 0.9 },
  { x: 8, y: -42, rotate: -6, scale: 0.85 },
  { x: -8, y: -56, rotate: 6, scale: 0.8 },
];

/** Stacking order of the cards; only their order matters, so keep it low. */
const CARD_Z_BASE = 10;

interface DragState {
  dx: number;
  dy: number;
  active: boolean;
}

/**
 * In-bubble preview for one or more image attachments. A single image is a
 * plain thumbnail; several images become a card stack — drag the front card
 * past the threshold (or scroll the wheel while hovering) to send it to the
 * back, click any card to bring it to the front, or click the front card to
 * open the full-screen viewer.
 *
 * Clicking (rather than only handling pointer gestures) keeps the cards usable
 * from the keyboard and assistive tech; a swipe swallows the click it would
 * otherwise also fire.
 */
export function ImageStack({
  images,
  self,
}: ImageStackProps): React.JSX.Element {
  const count = images.length;
  const single = count === 1;
  const [front, setFront] = useState(0);
  const [drag, setDrag] = useState<DragState>({ dx: 0, dy: 0, active: false });
  const [lightbox, setLightbox] = useState<number | null>(null);
  /** Screen rect of the card the viewer opened from, for the open animation. */
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const stackRef = useRef<HTMLDivElement>(null);

  // Wheel over the deck flips it; a lone image has nothing to flip, so it never
  // intercepts the wheel.
  useWheelStep(
    stackRef,
    (direction) => setFront((value) => (value + direction + count) % count),
    !single,
  );

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (single || event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }
    setDrag({ dx: 0, dy: 0, active: true });
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!start.current) return;
    setDrag({
      dx: event.clientX - start.current.x,
      dy: event.clientY - start.current.y,
      active: true,
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    start.current = null;
    setDrag({ dx: 0, dy: 0, active: false });
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
    // A swipe still fires a click on release; swallow it so the gesture does
    // not also open the viewer (or re-front the card that just went back).
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    setFront((value) => (value + 1) % count);
  };

  const onCardClick = (
    position: number,
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    if (suppressClick.current) return;
    if (position === front) {
      setOrigin(event.currentTarget.getBoundingClientRect());
      setLightbox(front);
    } else {
      setFront(position);
    }
  };

  // The deck leans the same way regardless of which card is on top, so a
  // self (right-aligned) bubble mirrors the fan.
  const lean = self ? -1 : 1;

  return (
    <div
      ref={stackRef}
      className={cls("imb-image-stack", single && "imb-image-stack-single")}
    >
      {images.map((image, position) => {
        const rel = (position - front + count) % count;
        const isFront = rel === 0;
        const layer = CARD_LAYERS[Math.min(rel, CARD_LAYERS.length - 1)];
        const rotation =
          layer.rotate * lean + (isFront && drag.active ? drag.dx * 0.06 : 0);
        const style: CSSProperties = {
          transform: `translate3d(${layer.x + (isFront ? drag.dx : 0)}px, ${
            layer.y + (isFront ? drag.dy : 0)
          }px, 0) rotate(${rotation}deg) scale(${layer.scale})`,
          zIndex: CARD_Z_BASE - rel,
          transition: isFront && drag.active ? "none" : undefined,
        };
        return (
          <button
            key={image.index}
            type="button"
            className={cls("imb-image-card", isFront && "imb-image-card-front")}
            style={style}
            tabIndex={isFront ? 0 : -1}
            aria-label={t("Enlarge image")}
            title={
              isFront && !single
                ? t("Click to enlarge, drag or scroll to switch")
                : t("Enlarge image")
            }
            onPointerDown={isFront ? onPointerDown : undefined}
            onPointerMove={isFront ? onPointerMove : undefined}
            onPointerUp={isFront ? onPointerUp : undefined}
            onPointerCancel={isFront ? onPointerUp : undefined}
            onClick={(event) => onCardClick(position, event)}
          >
            <img src={image.src} alt={image.name} draggable={false} />
            {isFront && (
              <span className="imb-image-card-hint" aria-hidden="true">
                <IconOpen />
              </span>
            )}
          </button>
        );
      })}

      {count > 1 && (
        <span className="imb-image-stack-count" aria-hidden="true">
          {`${front + 1} / ${count}`}
        </span>
      )}

      {lightbox !== null && (
        <ImageLightbox
          images={images.map(({ name, src }) => ({ name, src }))}
          index={lightbox}
          origin={origin}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
