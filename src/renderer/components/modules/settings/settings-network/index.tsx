import { t } from "@shared/l10n";
import { useEffect, useRef, useState } from "react";
import { DetailBody } from "../../../detail-pane/detail-body";
import { DetailHead } from "../../../detail-pane/detail-head";
import { Field } from "../../../field";
import { Input } from "../../../input";
import "./index.css";

const SAVE_DEBOUNCE_MS = 400;
const SAVED_FLASH_MS = 1500;

/**
 * Settings → Network: the outbound HTTP(S) proxy used for model/provider
 * traffic. Changes are validated inline and persisted (then applied in the
 * main process) with a short debounce, mirroring the Environment variables
 * editor. An empty value means "connect directly".
 */
export function SettingsNetwork(): React.JSX.Element {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void imb.network.getProxy().then((stored) => {
      if (alive) setValue(stored);
    });
    return () => {
      alive = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const persist = async (next: string): Promise<void> => {
    try {
      await imb.network.setProxy(next);
      setError(null);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const change = (next: string): void => {
    setValue(next);
    setSaved(false);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!isValidProxy(next)) {
      setError(t("Proxy URL must be a valid http(s) URL."));
      return;
    }
    setError(null);
    saveTimerRef.current = setTimeout(
      () => void persist(next.trim()),
      SAVE_DEBOUNCE_MS,
    );
  };

  return (
    <>
      <DetailHead
        eyebrow="Network"
        title={t("Network")}
        sub={t("Proxy for outbound model requests")}
      />
      <DetailBody>
        <Field
          label={t("Proxy URL")}
          htmlFor="settings-proxy-url"
          hint={t(
            "Route outbound requests through an HTTP(S) proxy. Leave empty to connect directly. Local addresses (localhost) are always bypassed.",
          )}
          error={error ?? undefined}
        >
          <div className="imb-settings-proxy-row">
            <Input
              id="settings-proxy-url"
              value={value}
              placeholder="http://127.0.0.1:7890"
              mono
              invalid={error !== null}
              spellCheck={false}
              onChange={(e) => change(e.target.value)}
            />
            {saved && (
              <span className="imb-settings-proxy-saved">{t("Saved")}</span>
            )}
          </div>
        </Field>
      </DetailBody>
    </>
  );
}

/** Defensive mirror of the main-process check; empty is valid (direct). */
function isValidProxy(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
