import { t } from "@shared/l10n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconX } from "../icons";
import "./index.css";

/**
 * Transient module-level message (bottom-centre toast) for results that are not
 * errors but worth confirming — e.g. "unlinked from 2 employees" after deleting
 * an MCP server or uninstalling a skill.
 *
 * It is deliberately not a modal or an inline banner: the result is
 * informational, the list underneath must stay usable, and the message should
 * get out of the way on its own (`role="status"` so screen readers announce it).
 */

/** How long a notice stays on screen (matches the app's other result flashes). */
export const MODULE_NOTICE_MS = 5000;

export interface ModuleNoticeProps {
  message: string;
  onDismiss: () => void;
}

/** The toast itself; use `useModuleNotice` for the state + timer. */
export function ModuleNotice({
  message,
  onDismiss,
}: ModuleNoticeProps): React.JSX.Element {
  return (
    <div className="imb-module-notice" role="status">
      <span>{message}</span>
      <button
        type="button"
        className="imb-module-notice-close"
        aria-label={t("Close")}
        title={t("Close")}
        onClick={onDismiss}
      >
        <IconX className="imb-icon imb-sm" />
      </button>
    </div>
  );
}

export interface ModuleNoticeState {
  notice: string | null;
  /** Replace (and re-time) the current notice. */
  show: (message: string) => void;
  /** Hide immediately and cancel the timer. */
  dismiss: () => void;
}

/**
 * State + auto-dismiss timer for `ModuleNotice`. The timer is cleared on
 * unmount so a module switch never leaves a stray `setState` behind.
 */
export function useModuleNotice(
  durationMs: number = MODULE_NOTICE_MS,
): ModuleNoticeState {
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setNotice(null);
  }, []);

  const show = useCallback(
    (message: string): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setNotice(message);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setNotice(null);
      }, durationMs);
    },
    [durationMs],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Stable identity while the message is unchanged, so callers can list the
  // whole state object in a `useCallback`/`useEffect` dependency array.
  return useMemo(() => ({ notice, show, dismiss }), [notice, show, dismiss]);
}
