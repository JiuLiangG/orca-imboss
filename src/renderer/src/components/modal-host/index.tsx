import { Modal, type ModalProps } from "../modal";

/**
 * Single modal host (presentation only). Modules render their modals through
 * this component to keep the overlay mounted once; the `Modal` base component
 * already portals to `document.body`, so this is a thin convenience wrapper
 * for consistent modal stacking in one tree.
 */
export function ModalHost({
  open,
  onClose,
  ...rest
}: ModalProps): React.JSX.Element | null {
  return <Modal open={open} onClose={onClose} {...rest} />;
}
