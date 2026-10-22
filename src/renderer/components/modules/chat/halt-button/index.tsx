import { t } from "@shared/l10n";
import { HaltButton as HaltButtonBase } from "../../../halt-button";
import type { Placement } from "../../../tooltip/position";
import "./index.css";

export interface HaltButtonProps {
  /** Task group whose sessions should be interrupted. */
  chatId: number;
  /** Side the confirmation popup opens on (flips once when it would overflow). */
  placement?: Placement;
}

/**
 * Icon-only "Halt" affordance for the `chat` and `progress` cards: interrupts
 * **every** agent session belonging to the linked task group.
 *
 * Rendered as the **last child of the message row**, outside the card bubble,
 * and taken out of flow (see `.imb-halt`): absolutely positioned just right of
 * the bubble and vertically centred, so the bubble's width/geometry is identical
 * to when no button is present. Behaviour (confirm popup, busy state, failure
 * logging) comes from the shared `halt-button` component; this wrapper only
 * supplies the card semantics and the overlay class.
 *
 * Always shown — no run-state signal is tracked. Hover shows "Interrupt task"
 * and hides when the pointer leaves; the click still opens this confirmation.
 */
export function HaltButton({
  chatId,
  placement = "left",
}: HaltButtonProps): React.JSX.Element {
  return (
    <HaltButtonBase
      className="imb-halt"
      placement={placement}
      label={t("Halt")}
      hint={t("Interrupt task")}
      confirmText={t("Confirm interrupting this task group chat's sessions?")}
      onInterrupt={() => imb.agentSession.interruptChat(chatId)}
    />
  );
}
