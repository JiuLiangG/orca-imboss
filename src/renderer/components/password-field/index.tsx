import { t } from "@shared/l10n";
import { useEffect, useRef, useState } from "react";
import { Button } from "../button";
import "./index.css";

export interface PasswordFieldProps {
  /** Masked value or empty string (e.g. `sk-••••3fA2`). */
  value: string;
  /** Copy the real API key to the system clipboard; reject on failure. */
  onCopy: () => Promise<void>;
  placeholder?: string;
  id?: string;
  /** Disable the copy action (e.g. no key configured). */
  disabled?: boolean;
}

/**
 * Masked API-key readout with a "Copy" action. The real key never enters the
 * renderer: `onCopy` triggers a main-process clipboard write and only returns
 * success/failure; the copy button shows transient "Copied" feedback.
 */
export function PasswordField({
  value,
  onCopy,
  placeholder,
  id,
  disabled = false,
}: PasswordFieldProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timer on unmount.
  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function copy(): Promise<void> {
    setBusy(true);
    try {
      await onCopy();
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="imb-key-readonly">
      <span className="imb-masked" id={id}>
        {value || placeholder || "••••••••"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="imb-reveal"
        loading={busy}
        disabled={disabled || !value}
        onClick={() => void copy()}
      >
        {copied ? t("Copied") : t("Copy")}
      </Button>
    </div>
  );
}
