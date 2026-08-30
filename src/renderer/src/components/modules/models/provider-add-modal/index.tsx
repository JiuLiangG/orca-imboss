import { useCallback, useState } from "react";
import { t } from "../../../../../../shared/libs/l10n";
import {
  CURATED_PROVIDERS,
  CURATED_PROVIDERS_LABELS,
  PROVIDER_API_TYPES,
  type ProviderApiType,
  type ProviderUpsert,
} from "../../../../../../shared/types";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { PasswordInput } from "../../../password-field";
import { SegmentedControl } from "../../../segmented-control";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";
import "./index.css";

export interface ProviderAddModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (provider: ProviderUpsert) => Promise<void>;
}

type Mode = "built-in" | "custom";

/** Add provider modal: built-in (key only) or custom (full config). */
export function ProviderAddModal({
  open,
  onClose,
  onSaved,
}: ProviderAddModalProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("built-in");
  const [builtinId, setBuiltinId] = useState<string>(CURATED_PROVIDERS[0]);
  const [customId, setCustomId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiType, setApiType] = useState<ProviderApiType>("openai-completions");
  const [modelIds, setModelIds] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const reset = (): void => {
    setMode("built-in");
    setBuiltinId(CURATED_PROVIDERS[0]);
    setCustomId("");
    setBaseUrl("");
    setApiType("openai-completions");
    setModelIds("");
    setApiKey("");
    setError(null);
    setFetching(false);
    setFetchError(null);
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
      const ids = modelIds
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!customId.trim()) {
        setError(t("Please enter a provider ID."));
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
        baseUrl: baseUrl.trim(),
        apiType,
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

  const fetchModels = useCallback(async (): Promise<void> => {
    if (fetching) return;
    const key = apiKey.trim();
    if (!baseUrl.trim()) {
      setFetchError(t("Enter the base URL first."));
      return;
    }
    if (!key) {
      setFetchError(t("Enter the API key first."));
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const models = await window.imb.providers.listModels({
        baseUrl: baseUrl.trim(),
        apiType,
        apiKey: key,
      });
      if (models.length === 0) {
        setFetchError(t("No models returned."));
        return;
      }
      setModelIds(models.join("\n"));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }, [apiKey, apiType, baseUrl, fetching]);

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
          <Field label={t("API type")}>
            <Select
              value={apiType}
              options={PROVIDER_API_TYPES.map((type) => ({
                value: type,
                label: type,
              }))}
              onChange={(next) => setApiType(next as ProviderApiType)}
            />
          </Field>
          <Field label={t("Base URL")}>
            <Input
              value={baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
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
          <Field label={t("Model ids (one per line)")}>
            <Textarea
              value={modelIds}
              placeholder="model-a
model-b"
              minHeight={72}
              mono
              onChange={(e) => {
                setModelIds(e.target.value);
                if (fetchError !== null) setFetchError(null);
              }}
            />
            <div className="imb-model-fetch-row">
              <Button
                variant="secondary"
                size="sm"
                loading={fetching}
                disabled={fetching}
                onClick={() => void fetchModels()}
              >
                {t("Fetch models")}
              </Button>
              {fetchError !== null && (
                <span className="imb-error-text">{fetchError}</span>
              )}
            </div>
          </Field>
        </>
      )}
    </Modal>
  );
}
