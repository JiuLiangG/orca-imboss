import { t } from "@shared/l10n";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import {
  computeAnchoredPosition,
  type AnchoredPosition,
  type Placement,
} from "../tooltip/position";
import "./index.css";

const COLLAPSED_LINES = 4;

export interface SkillDescriptionTipProps {
  /** Outer node, so a click on the card is not treated as leaving the menu. */
  tipRef: RefObject<HTMLDivElement | null>;
  anchor: HTMLElement;
  description: string;
  placement: Placement;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  /** Anchor left the document (menu closed, list re-rendered). */
  onDismiss: () => void;
}

/**
 * Hover card for one skill description. The description is the skill file's
 * own text. "Show more" / "Show less" and the accessible name go through
 * `t()`, so a language switch rewrites those words and leaves the description.
 */
export function SkillDescriptionTip({
  tipRef,
  anchor,
  description,
  placement,
  onPointerEnter,
  onPointerLeave,
  onDismiss,
}: SkillDescriptionTipProps): React.JSX.Element | null {
  const measureRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [pos, setPos] = useState<AnchoredPosition | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    setExpanded(false);
  }, [description]);

  const place = (): void => {
    if (!anchor.isConnected) {
      onDismissRef.current();
      return;
    }
    const card = tipRef.current;
    if (!card) return;
    const next = computeAnchoredPosition(
      placement,
      anchor.getBoundingClientRect(),
      card.getBoundingClientRect(),
      0,
    );
    setPos((current) =>
      current &&
      current.top === next.top &&
      current.left === next.left &&
      current.placement === next.placement
        ? current
        : next,
    );
  };

  useLayoutEffect(() => {
    const measured = measureRef.current;
    if (!measured) return;
    const lineHeight = Number.parseFloat(getComputedStyle(measured).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    setOverflows(measured.scrollHeight > lineHeight * COLLAPSED_LINES + 1);
  }, [description]);

  useLayoutEffect(() => {
    place();
    // place() reads the latest anchor, card size, and dismiss callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, description, expanded, overflows, placement]);

  useEffect(() => {
    const reposition = (): void => place();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
    // Size changes are repositioned by the layout effect. This only follows
    // the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, placement]);

  return createPortal(
    <div
      ref={tipRef}
      className={cls("imb-skill-tip", pos && "imb-is-open")}
      style={{ top: pos?.top, left: pos?.left }}
      role="region"
      aria-label={t("Skill description")}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <div className="imb-skill-tip-card">
        <div className="imb-skill-tip-body">
          <p
            className={cls(
              "imb-skill-tip-text",
              expanded ? "imb-is-expanded" : "imb-is-clamped",
            )}
          >
            {description}
          </p>
          <p ref={measureRef} className="imb-skill-tip-measure" aria-hidden>
            {description}
          </p>
        </div>
        {overflows && (
          <button
            type="button"
            className="imb-skill-tip-toggle"
            aria-expanded={expanded}
            onMouseDown={(event) => {
              // The card is portaled. Keep this press from being seen as a
              // click outside the menu.
              event.stopPropagation();
            }}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t("Show less") : t("Show more")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
