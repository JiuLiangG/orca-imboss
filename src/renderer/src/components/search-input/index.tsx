import { useRef, useState, type InputHTMLAttributes } from "react";
import { t } from "../../../../shared/libs/l10n";
import { IconSearch, IconX } from "../icons";
import "./index.css";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange"
> {
  value: string;
  onValueChange: (value: string) => void;
}

/** Search box: icon + input + clear (`.searchbox`). */
export function SearchInput({
  value,
  onValueChange,
  placeholder,
  className,
  ...rest
}: SearchInputProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  return (
    <div
      className={`imb-searchbox${focused ? " imb-is-focused" : ""}${className ? ` ${className}` : ""}`}
    >
      <IconSearch className="imb-icon imb-sm" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
      />
      {value.length > 0 && (
        <button
          type="button"
          className="imb-searchbox-clear"
          aria-label={t("Clear")}
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
        >
          <IconX className="imb-icon imb-sm" />
        </button>
      )}
    </div>
  );
}
