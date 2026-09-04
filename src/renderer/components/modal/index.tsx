import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { trapFocus } from "../../utils/ui";
import "./index.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  /** Footer action buttons (rendered by the caller). */
  actions?: ReactNode;
  /** Inline validation error shown above the footer. */
  error?: ReactNode;
  size?: "md" | "lg";
}

/**
 * Overlay + dialog (max-width 480 default, Esc/overlay close, focus
 * management, focus trap). Rendered into `document.body` so it always escapes
 * the module portal trees.
 */
export function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  actions,
  error,
  size = "md",
}: ModalProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  // Keep the latest `onClose` in a ref so the effect below only runs when the
  // dialog actually opens (not on every re-render caused by a changing inline
  // `onClose` callback, which would otherwise steal focus back to the
  // autofocused control on each keystroke).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Prefer an explicitly "autofocused" control; fall back to first control.
    const dialog = dialogRef.current;
    const preferred = dialog?.querySelector<HTMLElement>("[data-autofocus]");
    const first =
      preferred ??
      dialog?.querySelector<HTMLElement>(
        'input, textarea, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    first?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        trapFocus(dialog, event);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="imb-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cls("imb-modal", size === "lg" && "imb-modal-lg")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        ref={dialogRef}
      >
        <div className="imb-modal-head">
          <h3 id={titleId.current}>{title}</h3>
          {sub !== undefined && <div className="imb-sub">{sub}</div>}
        </div>
        <div className="imb-modal-body">{children}</div>
        {error !== undefined && error !== null && error !== "" && (
          <p className="imb-error-text imb-modal-error">{error}</p>
        )}
        {actions !== undefined && (
          <div className="imb-modal-actions">{actions}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
