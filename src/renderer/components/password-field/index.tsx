import { t } from "@shared/l10n";
import { useEffect, useRef, useState } from "react";
import { cls } from "reactutils";
import { Button } from "../button";
import { IconKey } from "../icons";
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

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const copy = async (): Promise<void> => {
    setBusy(true);
    try {
      await onCopy();
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } finally {
      setBusy(false);
    }
  };

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

export function PasswordInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  autoFocus?: boolean;
  label?: string;
}): React.JSX.Element {
  return (
    <div className="imb-key-input-wrap">
      <span className="imb-key-input-icon">
        <IconKey />
      </span>
      <input
        className={cls(
          "imb-input",
          "imb-key-input",
          props.invalid && "imb-is-invalid",
        )}
        id={props.id}
        type="password"
        value={props.value}
        placeholder={props.placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus={props.autoFocus}
        aria-label={props.label}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}
