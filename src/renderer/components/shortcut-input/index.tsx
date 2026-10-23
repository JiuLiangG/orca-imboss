import { t } from "@shared/l10n";
import {
  acceleratorFromKeyboardEvent,
  formatAccelerator,
  validateAccelerator,
  type ShortcutRejectReason,
} from "@shared/shortcut";
import { useCallback, useEffect, useRef, useState } from "react";
import { cls } from "reactutils";
import "./index.css";

/** Localized explanation for a rejected accelerator. */
export function shortcutRejectMessage(reason: ShortcutRejectReason): string {
  switch (reason) {
    case "invalid":
      return t("That cannot be used as a shortcut.");
    case "noModifier":
      return t(
        "Include at least one of ⌘ / Ctrl / Alt — a plain key would be taken from every app.",
      );
    case "reserved":
      return t("That combination belongs to the system.");
    case "appShortcut":
      return t("That combination is already used inside imboss.");
    case "conflict":
      return t(
        "Another app already uses that combination. Pick a different one.",
      );
  }
}

/** Keys that only carry a modifier — recording waits for the real key. */
const MODIFIER_CODES = new Set([
  "MetaLeft",
  "MetaRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "CapsLock",
  "Fn",
]);

export interface ShortcutInputProps {
  /** Current accelerator (`null` = the shortcut is turned off). */
  value: string | null;
  /** Built-in default of this platform (what "Reset" restores). */
  defaultAccelerator: string;
  /** Localized message from the last rejected / failed registration. */
  error?: string | null;
  /** Commit a recorded accelerator (`""` turns the feature off). */
  onCommit: (accelerator: string) => Promise<void>;
}

/**
 * Accelerator recorder for a global (OS-level) shortcut.
 *
 * While it listens, the app's own registration is suspended: otherwise pressing
 * the *current* combination would be swallowed by the OS and hide the window the
 * user is working in.
 */
export function ShortcutInput({
  value,
  defaultAccelerator,
  error,
  onCommit,
}: ShortcutInputProps): React.JSX.Element {
  const [recording, setRecording] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const recordingRef = useRef(false);

  const resume = useCallback((): void => {
    void imb.windowControls.suspendShortcut(false).catch(() => {});
  }, []);

  const stopRecording = useCallback((): void => {
    recordingRef.current = false;
    setRecording(false);
    resume();
  }, [resume]);

  const startRecording = useCallback(async (): Promise<void> => {
    setLocalError(null);
    recordingRef.current = true;
    setRecording(true);
    try {
      await imb.windowControls.suspendShortcut(true);
    } catch {
      // Recording still works; the old shortcut may fire while we listen.
    }
  }, []);

  // Leaving Settings mid-recording must not leave the global shortcut disabled.
  useEffect(
    () => () => {
      if (recordingRef.current) {
        recordingRef.current = false;
        resume();
      }
    },
    [resume],
  );

  // If the window loses focus mid-recording (tray click, another app stealing
  // the combination), stop listening and give the global shortcut back — a
  // recorder left in this state would keep the hotkey unregistered.
  useEffect(() => {
    if (!recording) return;
    const onBlur = (): void => {
      setLocalError(null);
      stopRecording();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [recording, stopRecording]);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      // Never hijack a key the IME is currently consuming.
      if (event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();

      if (
        event.key === "Escape" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        stopRecording();
        setLocalError(null);
        return;
      }
      // Wait for a real key: a modifier on its own is not a combination.
      if (MODIFIER_CODES.has(event.code)) return;

      const accelerator = acceleratorFromKeyboardEvent(event, imb.platform);
      if (accelerator === null) {
        setLocalError(
          t("Press a modifier combination, for example ⌘⇧B or Ctrl+Alt+B."),
        );
        return;
      }
      const check = validateAccelerator(accelerator, imb.platform);
      if (!check.ok) {
        setLocalError(shortcutRejectMessage(check.reason));
        return;
      }

      stopRecording();
      setLocalError(null);
      void onCommit(check.accelerator);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, stopRecording, onCommit]);

  const message = localError ?? error ?? null;
  const isDefault = value !== null && value === defaultAccelerator;

  return (
    <div className="imb-shortcut">
      <div className="imb-shortcut-row">
        <span
          className={cls(
            "imb-shortcut-value",
            recording && "imb-is-recording",
            value === null && !recording && "imb-is-off",
          )}
          aria-live="polite"
        >
          {recording
            ? t("Press the new shortcut… (Esc to cancel)")
            : value === null
              ? t("Off")
              : formatAccelerator(value, imb.platform)}
        </span>

        <button
          type="button"
          className="imb-shortcut-btn"
          onClick={() => {
            if (recording) {
              stopRecording();
              setLocalError(null);
              return;
            }
            void startRecording();
          }}
        >
          {recording ? t("Cancel") : value === null ? t("Set") : t("Change")}
        </button>

        {!recording && value !== null && !isDefault && (
          <button
            type="button"
            className="imb-shortcut-btn"
            onClick={() => {
              setLocalError(null);
              void onCommit(defaultAccelerator);
            }}
          >
            {t("Reset")}
          </button>
        )}

        {!recording && value !== null && (
          <button
            type="button"
            className="imb-shortcut-btn"
            onClick={() => {
              setLocalError(null);
              void onCommit("");
            }}
          >
            {t("Turn off")}
          </button>
        )}
      </div>

      {message && <span className="imb-shortcut-error">{message}</span>}
    </div>
  );
}
