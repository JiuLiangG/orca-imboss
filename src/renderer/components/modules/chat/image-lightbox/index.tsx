import { t } from "@shared/l10n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useWheelStep } from "../../../../hooks/use-wheel-step";
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

/**
 * Full-screen image viewer for the in-chat attachment previews. Rendered into
 * `document.body` so it escapes the thread's stacking context. Esc closes,
 * arrow keys / on-screen arrows / the wheel step between images, and a click on
 * the backdrop (never the image) closes.
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

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      } else if (count > 1 && event.key === "ArrowLeft") {
        event.stopPropagation();
        onIndexChange((index - 1 + count) % count);
      } else if (count > 1 && event.key === "ArrowRight") {
        event.stopPropagation();
        onIndexChange((index + 1) % count);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [count, index, onIndexChange, onClose]);

  useWheelStep(
    overlayRef,
    (direction) => onIndexChange((index + direction + count) % count),
    count > 1,
  );

  // FLIP the image out of the thumbnail: place it at the thumbnail's box for
  // the first paint, then release it to its natural size on the next frame so
  // the transform transitions.
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
          onClick={() => onIndexChange((index - 1 + count) % count)}
          aria-label={t("Previous image")}
          title={t("Previous image")}
        >
          <IconChevronDown />
        </button>
      )}

      <figure className="imb-lightbox-figure">
        <img
          key={index}
          ref={imageRef}
          className="imb-lightbox-image"
          src={current.src}
          alt={current.name}
          draggable={false}
        />
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
          onClick={() => onIndexChange((index + 1) % count)}
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
