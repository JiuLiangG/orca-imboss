import { t } from "@shared/l10n";
import { useRef, useState } from "react";
import { cls } from "reactutils";
import { Button } from "../../../button";
import { IconHalt } from "../../../icons";
import { Popover } from "../../../popover";
import type { Placement } from "../../../tooltip/position";
import "./index.css";

export interface HaltButtonProps {
  /** Task group whose sessions should be interrupted. */
  chatId: number;
  /** Positioning modifier from the host card (corner placement differs). */
  className?: string;
  /** Side the confirmation popup opens on (flips once when it would overflow). */
  placement?: Placement;
}

/**
 * Icon-only "Halt" affordance shared by the `chat` and `progress` cards.
 *
 * Clicking it opens a small confirmation popup anchored to the button; on
 * confirm it interrupts every agent session belonging to the linked task group
 * (its non-assistant employee participants plus the assistant's root
 * orchestration session). A card has no error surface, so a failed interrupt is
 * only logged (matching the module's convention). Always shown — no run-state
 * signal is tracked.
 */
export function HaltButton({
  chatId,
  className,
  placement = "left",
}: HaltButtonProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = t("Halt");

  const close = (): void => {
    // Never close mid-flight; the request settles and closes on its own.
    if (!busy) setOpen(false);
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await imb.agentSession.interruptChat(chatId);
    } catch (err) {
      console.error(`[halt] failed to interrupt chat ${chatId}:`, err);
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
        className={cls("imb-halt", className)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <IconHalt />
      </button>
      <Popover
        open={open}
        anchorRef={triggerRef}
        placement={placement}
        onClose={close}
      >
        <p className="imb-halt-confirm-text">
          {t("Confirm interrupting this task group chat's sessions?")}
        </p>
        <div className="imb-halt-confirm-actions">
          <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => void confirm()}
            loading={busy}
          >
            {label}
          </Button>
        </div>
      </Popover>
    </>
  );
}
