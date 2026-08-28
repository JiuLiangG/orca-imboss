import { useState } from "react";
import { t } from "../../../../shared/libs/l10n";
import { IconKey } from "../icons";
import { Button } from "../button";
import "./index.css";

export interface PasswordFieldProps {
  /** Masked value or empty string (e.g. `sk-••••3fA2`). */
  value: string;
  /** What the reveal action resolves to (may be null when unavailable). */
  onReveal: () => Promise<string | null>;
  placeholder?: string;
  /** Fired when the user replaces the key via the field. */
  onChange?: (value: string) => void;
  invalid?: boolean;
  id?: string;
}

/**
 * Masked API-key readout (`.key-readonly` + `显示/隐藏` reveal). The real key
 * is only fetched from main on explicit reveal and only kept in local state.
 */
export function PasswordField({
  value,
  onReveal,
  placeholder,
  onChange,
  invalid = false,
  id,
}: PasswordFieldProps): React.JSX.Element {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (): Promise<void> => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    setBusy(true);
    try {
      const key = await onReveal();
      setRevealed(key ?? value);
    } finally {
      setBusy(false);
    }
  };

  const showing = revealed !== null;

  return (
    <div className={`imb-key-readonly${invalid ? " imb-has-error" : ""}`}>
      <span className="imb-masked" id={id}>
        {showing ? revealed : value || placeholder || "••••••••"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="imb-reveal"
        loading={busy}
        disabled={!value && !showing}
        onClick={() => void toggle()}
      >
        {showing ? t("Hide") : t("Reveal")}
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
        className={`imb-input imb-key-input${props.invalid ? " imb-is-invalid" : ""}`}
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
