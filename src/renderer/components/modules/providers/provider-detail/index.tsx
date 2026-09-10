import { t } from "@shared/l10n";
import type { ProviderInfo, ProviderUpsert } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../button";
import { DetailBody } from "../../../detail-pane/detail-body";
import { DetailHead } from "../../../detail-pane/detail-head";
import { Field } from "../../../field";
import { Modal } from "../../../modal";
import { PasswordField } from "../../../password-field";
import { PasswordInput } from "../../../password-input";
import {
  isHttpUrl,
  parseModelIds,
  ProviderConfigFields,
  providerConfigToForm,
  type ProviderConfigFormValue,
} from "../provider-config-fields";
import "./index.css";

export interface ProviderDetailProps {
  provider: ProviderInfo;
  /** Persist the edited configuration (add-or-update). */
  onSave: (input: ProviderUpsert) => Promise<void>;
  onRemove: () => void;
}

/** Transient "Saved" feedback duration. */
const SAVED_FLASH_MS = 1500;

/**
 * Provider detail: kind badge, masked key + copy, and inline editing.
 *
 * - built-in → only the API key can be replaced.
 * - custom   → base URL / API type / model ids are editable; the provider id
 *   is immutable (it is the auth/models key and is referenced by model ids).
 *
 * The plaintext key is never readable, so editing means entering a new key;
 * leaving the "New API key" field blank keeps the stored key (the backend
 * treats an omitted `apiKey` as "keep").
 */
export function ProviderDetail({
  provider,
  onSave,
  onRemove,
}: ProviderDetailProps): React.JSX.Element {
  const [config, setConfig] = useState<ProviderConfigFormValue>(() =>
    providerConfigToForm(provider),
  );
  const [apiKey, setApiKey] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const copy = async (): Promise<void> => {
    try {
      await imb.providers.copyKey(provider.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateConfig = (next: ProviderConfigFormValue): void => {
    setConfig(next);
    setDirty(true);
    setError(null);
  };

  const updateKey = (value: string): void => {
    setApiKey(value);
    setDirty(true);
    setError(null);
  };

  const cancel = (): void => {
    setConfig(providerConfigToForm(provider));
    setApiKey("");
    setDirty(false);
    setSaved(false);
    setError(null);
  };

  const key = apiKey.trim();
  // Built-ins always have a stored key (they are only listed once configured),
  // so replacing one requires a non-empty input; custom edits may omit it.
  const canSave =
    dirty && !saving && (provider.kind === "custom" || key.length > 0);

  const save = async (): Promise<void> => {
    if (!canSave) return;
    let input: ProviderUpsert;
    if (provider.kind === "built-in") {
      input = { id: provider.id, kind: "built-in", apiKey: key };
    } else {
      const baseUrl = config.baseUrl.trim();
      const modelIds = parseModelIds(config.modelIds);
      if (!baseUrl) {
        setError(t("Please enter a base URL."));
        return;
      }
      if (!isHttpUrl(baseUrl)) {
        setError(t("Base URL must be a valid http(s) URL."));
        return;
      }
      if (modelIds.length === 0) {
        setError(t("At least one model ID is required."));
        return;
      }
      if (key.length > 0 && key.length < 8) {
        setError(t("API key looks invalid."));
        return;
      }
      input = {
        id: provider.id,
        kind: "custom",
        baseUrl,
        apiType: config.apiType,
        modelIds,
        ...(key.length > 0 ? { apiKey: key } : {}),
      };
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(input);
      // Reflect what was persisted (trimmed base URL, de-duplicated model ids)
      // without depending on the reloaded provider identity.
      setConfig((prev) => ({
        ...prev,
        baseUrl: input.baseUrl ?? prev.baseUrl,
        modelIds: input.modelIds ? input.modelIds.join("\n") : prev.modelIds,
      }));
      setApiKey("");
      setDirty(false);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const masked = provider.keyHint ? `••••••••${provider.keyHint}` : "••••••••";

  return (
    <>
      <DetailHead
        eyebrow="Provider"
        title={provider.id}
        sub={provider.kind === "custom" ? t("Custom") : t("Built-in")}
        actions={
          <>
            {saved && <span className="imb-provider-saved">{t("Saved")}</span>}
            {dirty && (
              <Button
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={cancel}
              >
                {t("Cancel")}
              </Button>
            )}
            <Button
              size="sm"
              loading={saving}
              disabled={!canSave}
              onClick={() => void save()}
            >
              {t("Save")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setRemoveOpen(true)}
            >
              {t("Remove")}
            </Button>
          </>
        }
      />
      <DetailBody>
        {provider.kind === "custom" && (
          <>
            <Field label={t("Provider id")}>
              <span className="imb-provider-info imb-mono">{provider.id}</span>
            </Field>
            <ProviderConfigFields
              idPrefix={`provider-${provider.id}`}
              value={config}
              onChange={updateConfig}
              apiKey={apiKey}
              onFetchModels={(query) => imb.providers.listModels(query)}
            />
          </>
        )}
        <Field label={t("API key")}>
          <PasswordField
            value={masked}
            onCopy={copy}
            disabled={!provider.hasKey}
          />
        </Field>
        <Field
          label={t("New API key")}
          htmlFor={`provider-key-${provider.id}`}
          hint={
            provider.hasKey
              ? t("Leave blank to keep the current key.")
              : undefined
          }
        >
          <PasswordInput
            id={`provider-key-${provider.id}`}
            value={apiKey}
            onChange={updateKey}
            placeholder="sk-…"
          />
        </Field>
        {error !== null && <p className="imb-error-text">{error}</p>}
      </DetailBody>

      <Modal
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title={t("Remove provider")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoveOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setRemoveOpen(false);
                onRemove();
              }}
            >
              {t("Remove")}
            </Button>
          </>
        }
      >
        <p className="imb-provider-remove-note">
          {t("The provider's API key and custom model config will be deleted.")}
        </p>
      </Modal>
    </>
  );
}
