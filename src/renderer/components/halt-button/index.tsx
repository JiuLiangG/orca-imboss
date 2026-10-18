import { t } from "@shared/l10n";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "../button";
import { IconHalt } from "../icons";
import { Popover } from "../popover";
import type { Placement } from "../tooltip/position";
import "./index.css";

export interface HaltButtonProps {
  /**
   * Performs the interrupt. Called after the boss confirms — or immediately when
   * `confirm` is `false`. The returned value is ignored (callers surface
   * counts/errors through their own means). A rejection is logged and never
   * breaks the button's busy/close path.
   */
  onInterrupt: () => Promise<unknown>;
  /**
   * Confirmation copy shown in the popover. Required while `confirm` is on;
   * ignored (and may be omitted) when it is off.
   */
  confirmText?: string;
  /**
   * Whether the interrupt asks for confirmation first. Defaults to `true`.
   *
   * The cards (`chat` Halt = stop every session of a task group) keep the
   * confirmation. The agent-session view turns it off: stopping one turn is cheap
   * and reversible by simply talking again, so the boss asked for a single click.
   */
  confirm?: boolean;
  /**
   * Accessible name, hover title **and** the confirm button's label. Defaults to
   * `t("Halt")`; views that interrupt something narrower (one turn of one
   * session) pass their own copy.
   */
  label?: string;
  /** Side the confirmation popup opens on (flips once when it would overflow). */
  placement?: Placement;
  /**
   * Class of the trigger button. Placement/geometry deliberately live in the
   * caller's CSS: a card renders it as an absolute overlay next to a bubble,
   * the session view as a labelled chip in a header.
   */
  className?: string;
  /** Trigger content; defaults to the `IconHalt` glyph. */
  children?: ReactNode;
}

/**
 * Interrupt affordance shared by the chat / progress cards (Halt: every session
 * of a task group) and the agent-session view (interrupt the current turn of that
 * one session).
 *
 * The trigger is an ordinary `<button>` styled by the caller: this component owns
 * only the behaviour. With `confirm` (the default) it opens a small confirmation
 * popup anchored to the button, stays open while the request is in flight
 * (`busy`), then closes on settle. Without it the first click performs the
 * interrupt and the button is merely disabled (and `aria-busy`) until it
 * settles — no popup, no toast, no extra copy.
 */
export function HaltButton({
  onInterrupt,
  confirmText,
  confirm = true,
  label = t("Halt"),
  placement = "left",
  className,
  children,
}: HaltButtonProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = (): void => {
    // Never close mid-flight; the request settles and closes on its own.
    if (!busy) setOpen(false);
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      await onInterrupt();
    } catch (err) {
      console.error(`[halt] interrupt failed:`, err);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={label}
        {...(confirm
          ? { "aria-haspopup": "dialog", "aria-expanded": open }
          : {})}
        {...(confirm ? {} : { "aria-busy": busy, disabled: busy })}
        title={label}
        onClick={confirm ? () => setOpen((value) => !value) : () => void run()}
      >
        {children ?? <IconHalt />}
      </button>
      {confirm && (
        <Popover
          open={open}
          anchorRef={triggerRef}
          placement={placement}
          onClose={close}
        >
          <p className="imb-halt-confirm-text">{confirmText ?? label}</p>
          <div className="imb-halt-confirm-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={close}
              disabled={busy}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void run()}
              loading={busy}
            >
              {label}
            </Button>
          </div>
        </Popover>
      )}
    </>
  );
}
