import {
  isSubscriptionLoginProvider,
  SUBSCRIPTION_LOGIN_LABELS,
  XAI_UNREACHABLE,
} from "@shared/constants/providers";
import { t } from "@shared/l10n";
import type { ProviderLoginEvent } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../button";
import { Modal } from "../../../modal";
import "./index.css";

export interface SubscriptionLoginProps {
  providerId: string;
  /** Called after the credential is stored and the model catalog refresh returns. */
  onSignedIn: () => Promise<void>;
}

const CANCELLED = "Login cancelled";

/**
 * Device-code sign-in for providers whose Pi auth is a subscription
 * (today: xAI / SuperGrok). The main process opens the verification page;
 * this dialog shows the code and waits.
 */
export function SubscriptionLogin({
  providerId,
  onSignedIn,
}: SubscriptionLoginProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState<ProviderLoginEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const phaseRef = useRef<"idle" | "pending" | "done">("idle");

  useEffect(() => {
    return imb.providers.onLoginEvent((event) => {
      if (phaseRef.current !== "pending") return;
      setDevice(event);
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
    setDevice(null);
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
    setDevice(null);
    setError(null);
    setCopied(false);
    setOpen(true);
    void imb.providers
      .login(providerId)
      .then(async () => {
        if (phaseRef.current !== "pending") return;
        phaseRef.current = "done";
        setOpen(false);
        setDevice(null);
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
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={start}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={cancel}
        title={label}
        error={error ?? undefined}
        actions={
          <>
            {device && (
              <Button variant="secondary" onClick={() => void copyCode()}>
                {copied ? t("Copied") : t("Copy code")}
              </Button>
            )}
            {device && (
              <Button
                variant="secondary"
                onClick={() => {
                  window.open(device.verificationUri, "_blank", "noopener");
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
        {device ? (
          <div className="imb-sub-login">
            <p className="imb-sub-login-note">
              {t("Open this page and enter the code.")}
            </p>
            <p className="imb-sub-login-code">{device.userCode}</p>
            <p className="imb-sub-login-url">{device.verificationUri}</p>
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
