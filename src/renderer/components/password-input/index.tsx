import { cls } from "reactutils";
import { IconKey } from "../icons";
import "./index.css";

export interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  autoFocus?: boolean;
  label?: string;
}

export function PasswordInput({
  invalid,
  id,
  value,
  placeholder,
  autoFocus,
  label,
  onChange,
}: PasswordInputProps): React.JSX.Element {
  return (
    <div className="imb-key-input-wrap">
      <span className="imb-key-input-icon">
        <IconKey />
      </span>
      <input
        className={cls(
          "imb-input",
          "imb-key-input",
          invalid && "imb-is-invalid",
        )}
        id={id}
        type="password"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
