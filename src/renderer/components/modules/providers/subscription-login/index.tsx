import {
  isSubscriptionLoginProvider,
  SUBSCRIPTION_LOGIN_LABELS,
  XAI_UNREACHABLE,
} from "@shared/constants/providers";
import { t } from "@shared/l10n";
import type { ProviderLoginEvent } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../button";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import "./index.css";

export interface SubscriptionLoginProps {
  providerId: string;
  /** Called after the credential is stored and the model catalog refresh returns. */
  onSignedIn: () => Promise<void>;
}

const CANCELLED = "Login cancelled";
const PASTE_NOTE =
  "Finish signing in in the browser. If the page does not come back, paste the address-bar URL or the code.";

type PendingLogin =
  | { kind: "device"; userCode: string; verificationUri: string }
  | {
      kind: "browser";
      verificationUri: string;
      placeholder?: string;
      pasteReady: boolean;
    };

/**
 * Subscription sign-in. xAI shows a device code. Anthropic opens Pi's
 * Claude Pro/Max authorize page and, when the loopback callback does not
 * finish, accepts the code or redirect URL pasted here.
 */
export function SubscriptionLogin({
  providerId,
  onSignedIn,
}: SubscriptionLoginProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const phaseRef = useRef<"idle" | "pending" | "done">("idle");

  useEffect(() => {
    return imb.providers.onLoginEvent((event) => {
      if (phaseRef.current !== "pending") return;
      setPending((current) => applyLoginEvent(current, event));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (phaseRef.current === "pending") {
        phaseRef.current = "idle";
        void imb.providers.cancelLogin();
      }
    };
  }, []);

  if (!isSubscriptionLoginProvider(providerId)) return null;

  const label = t(SUBSCRIPTION_LOGIN_LABELS[providerId]);

  const closeQuiet = (): void => {
    phaseRef.current = "idle";
    setOpen(false);
    setPending(null);
    setPaste("");
    setError(null);
    setCopied(false);
  };

  const cancel = (): void => {
    phaseRef.current = "idle";
    void imb.providers.cancelLogin();
    closeQuiet();
  };

  const start = (): void => {
    if (phaseRef.current === "pending") return;
    phaseRef.current = "pending";
    setPending(null);
    setPaste("");
    setError(null);
    setCopied(false);
    setOpen(true);
    void imb.providers
      .login(providerId)
      .then(async () => {
        if (phaseRef.current !== "pending") return;
        phaseRef.current = "done";
        setOpen(false);
        setPending(null);
        setPaste("");
        await onSignedIn();
        phaseRef.current = "idle";
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (phaseRef.current !== "pending" || message === CANCELLED) {
          if (phaseRef.current === "pending") closeQuiet();
          return;
        }
        phaseRef.current = "idle";
        setError(
          t(message.includes(XAI_UNREACHABLE) ? XAI_UNREACHABLE : message),
        );
      });
  };

  const copyCode = async (): Promise<void> => {
    if (pending?.kind !== "device") return;
    try {
      await navigator.clipboard.writeText(pending.userCode);
      setCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitCode = async (): Promise<void> => {
    const value = paste.trim();
    if (!value) {
      setError(t("Paste the authorization code first."));
      return;
    }
    try {
      await imb.providers.submitLogin(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t(message));
    }
  };

  const verificationUri =
    pending?.kind === "device" || pending?.kind === "browser"
      ? pending.verificationUri
      : "";

  return (
    <>
      <Button
        style={{ fontSize: "var(--imb-text-sm)" }}
        variant="secondary"
        onClick={start}
      >
        {label}
      </Button>
      <Modal
        open={open}
        onClose={cancel}
        title={label}
        error={error ?? undefined}
        actions={
          <>
            {pending?.kind === "device" && (
              <Button variant="secondary" onClick={() => void copyCode()}>
                {copied ? t("Copied") : t("Copy code")}
              </Button>
            )}
            {pending?.kind === "browser" && pending.pasteReady && (
              <Button variant="secondary" onClick={() => void submitCode()}>
                {t("Submit code")}
              </Button>
            )}
            {verificationUri && (
              <Button
                variant="secondary"
                onClick={() => {
                  window.open(verificationUri, "_blank", "noopener");
                }}
              >
                {t("Open browser")}
              </Button>
            )}
            <Button variant="secondary" onClick={cancel}>
              {t("Cancel")}
            </Button>
          </>
        }
      >
        {pending?.kind === "device" ? (
          <div className="imb-sub-login">
            <p className="imb-sub-login-note">
              {t("Open this page and enter the code.")}
            </p>
            <p className="imb-sub-login-code">{pending.userCode}</p>
            <p className="imb-sub-login-url">{pending.verificationUri}</p>
          </div>
        ) : pending?.kind === "browser" ? (
          <div className="imb-sub-login">
            <p className="imb-sub-login-note">{t(PASTE_NOTE)}</p>
            {pending.verificationUri && (
              <p className="imb-sub-login-url">{pending.verificationUri}</p>
            )}
            {pending.pasteReady && (
              <Input
                className="imb-sub-login-paste"
                mono
                value={paste}
                placeholder={pending.placeholder ?? "code#state"}
                onChange={(event) => setPaste(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitCode();
                }}
              />
            )}
          </div>
        ) : (
          <p className="imb-sub-login-note">
            {t("Waiting for authorization in the browser…")}
          </p>
        )}
      </Modal>
    </>
  );
}

function applyLoginEvent(
  current: PendingLogin | null,
  event: ProviderLoginEvent,
): PendingLogin {
  if (event.type === "device_code") {
    return {
      kind: "device",
      userCode: event.userCode,
      verificationUri: event.verificationUri,
    };
  }
  if (event.type === "auth_url") {
    return {
      kind: "browser",
      verificationUri: event.verificationUri,
      placeholder:
        current?.kind === "browser" ? current.placeholder : undefined,
      pasteReady: current?.kind === "browser" ? current.pasteReady : false,
    };
  }
  return {
    kind: "browser",
    verificationUri: current?.kind === "browser" ? current.verificationUri : "",
    placeholder: event.placeholder,
    pasteReady: true,
  };
}
