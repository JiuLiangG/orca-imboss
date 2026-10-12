import { t } from "@shared/l10n";
import "./index.css";

/** Number of dots in the looping "thinking" indicator. */
const DOT_COUNT = 6;

/**
 * The six static dots. Rendered twice: once as the always-visible dim track
 * and once inside the lit overlay that is revealed one dot at a time.
 */
function Dots(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <span key={index} className="imb-ack-dot" aria-hidden="true" />
      ))}
    </>
  );
}

/**
 * Rendered in place of the persisted `ack` receipt message: a centered, muted
 * looping progress-bar indicator (six dots filling left to right) shown while
 * the assistant works on the user's message.
 *
 * Visibility is CSS-only (see `index.css`): every indicator followed by a real
 * message is hidden, so only the trailing ack animates and stale acks stay
 * hidden after a reload.
 */
export function AckIndicator(): React.JSX.Element {
  return (
    <div className="imb-ack" role="status" aria-label={t("Thinking…")}>
      <div className="imb-ack-track">
        <Dots />
        <div className="imb-ack-fill" aria-hidden="true">
          <Dots />
        </div>
      </div>
    </div>
  );
}
