import {
  CURATED_PROVIDERS,
  CURATED_PROVIDERS_LABELS,
  isSubscriptionLoginProvider,
} from "@shared/constants/providers";
import { t } from "@shared/l10n";
import type { ProviderUpsert } from "@shared/types";
import { useState } from "react";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { PasswordInput } from "../../../password-input";
import { SegmentedControl } from "../../../segmented-control";
import { Select } from "../../../select";
import {
  EMPTY_PROVIDER_CONFIG,
  isHttpUrl,
  parseModelIds,
  ProviderConfigFields,
  type ProviderConfigFormValue,
} from "../provider-config-fields";
import { SubscriptionLogin } from "../subscription-login";

export interface ProviderAddModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (provider: ProviderUpsert) => Promise<void>;
  /** Subscription sign-in stored the credential; the parent reloads the list. */
  onSignedIn: (providerId: string) => Promise<void>;
}

type Mode = "built-in" | "custom";

export function ProviderAddModal({
  open,
  onClose,
  onSaved,
  onSignedIn,
}: ProviderAddModalProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("built-in");
  const [builtinId, setBuiltinId] = useState<string>(CURATED_PROVIDERS[0]);
  const [customId, setCustomId] = useState("");
  const [config, setConfig] = useState<ProviderConfigFormValue>(
    EMPTY_PROVIDER_CONFIG,
  );
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setMode("built-in");
    setBuiltinId(CURATED_PROVIDERS[0]);
    setCustomId("");
    setConfig(EMPTY_PROVIDER_CONFIG);
    setApiKey("");
    setError(null);
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const key = apiKey.trim();
    let input: ProviderUpsert | null = null;
    if (mode === "built-in") {
      if (!key) {
        setError(t("Please enter an API key."));
        return;
      }
      input = { id: builtinId, kind: "built-in", apiKey: key };
    } else {
      const baseUrl = config.baseUrl.trim();
      const ids = parseModelIds(config.modelIds);
      if (!customId.trim()) {
        setError(t("Please enter a provider ID."));
        return;
      }
      if (!baseUrl) {
        setError(t("Please enter a base URL."));
        return;
      }
      if (!isHttpUrl(baseUrl)) {
        setError(t("Base URL must be a valid http(s) URL."));
        return;
      }
      if (ids.length === 0) {
        setError(t("At least one model ID is required."));
        return;
      }
      if (!key) {
        setError(t("Please enter an API key."));
        return;
      }
      input = {
        id: customId.trim(),
        kind: "custom",
        baseUrl,
        apiType: config.apiType,
        modelIds: ids,
        apiKey: key,
      };
    }
    setBusy(true);
    setError(null);
    try {
      await onSaved(input);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      title={t("Add Provider")}
      sub={t("Connect a new model provider.")}
      error={error ?? undefined}
      actions={
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t("Cancel")}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <Field label={t("Type")}>
        <SegmentedControl<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "built-in", label: t("Built-in") },
            { value: "custom", label: t("Custom") },
          ]}
        />
      </Field>

      {mode === "built-in" ? (
        <>
          <Field label={t("Provider")}>
            <Select
              value={builtinId}
              options={CURATED_PROVIDERS.map((id) => ({
                value: id,
                label: CURATED_PROVIDERS_LABELS[id],
              }))}
              onChange={setBuiltinId}
            />
          </Field>
          <SubscriptionLogin
            providerId={builtinId}
            onSignedIn={async () => {
              await onSignedIn(builtinId);
              reset();
              onClose();
            }}
          />
          {isSubscriptionLoginProvider(builtinId) && (
            <p className="imb-module-note">
              {t("Subscription sign-in does not need an API key.")}
            </p>
          )}
          <Field label={t("API key")}>
            <PasswordInput
              value={apiKey}
              onChange={setApiKey}
              placeholder="sk-…"
              invalid={error !== null}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={t("Provider id")}>
            <Input
              value={customId}
              placeholder="my-provider"
              data-autofocus
              onChange={(e) => setCustomId(e.target.value)}
            />
          </Field>
          <Field label={t("API key")}>
            <PasswordInput
              value={apiKey}
              onChange={setApiKey}
              placeholder="sk-…"
              invalid={error !== null}
            />
          </Field>
          <ProviderConfigFields
            idPrefix="provider-new"
            value={config}
            onChange={setConfig}
            apiKey={apiKey}
            onFetchModels={(query) => imb.providers.listModels(query)}
          />
        </>
      )}
    </Modal>
  );
}
