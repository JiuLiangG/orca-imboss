import { useState } from "react";
import {
  CURATED_PROVIDERS,
  PROVIDER_API_TYPES,
  type ProviderApiType,
  type ProviderUpsert,
} from "../../../../../../shared/types";
import { t } from "../../../../../../shared/libs/l10n";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Textarea } from "../../../textarea";
import { Modal } from "../../../modal";
import { SegmentedControl } from "../../../segmented-control";
import { PasswordInput } from "../../../password-field";

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

  const reset = (): void => {
    setMode("built-in");
    setBuiltinId(CURATED_PROVIDERS[0]);
    setCustomId("");
    setBaseUrl("");
    setApiType("openai-completions");
    setModelIds("");
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

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      title={t("Add provider")}
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
        <Field label={t("Provider")}>
          <SegmentedControl<string>
            value={builtinId}
            onChange={setBuiltinId}
            options={CURATED_PROVIDERS.map((id) => ({ value: id, label: id }))}
          />
        </Field>
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
          <Field label={t("Base URL")}>
            <Input
              value={baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </Field>
          <Field label={t("API type")}>
            <SegmentedControl<ProviderApiType>
              value={apiType}
              onChange={setApiType}
              options={PROVIDER_API_TYPES.map((type) => ({
                value: type,
                label: type,
              }))}
            />
          </Field>
          <Field label={t("Model ids (one per line)")}>
            <Textarea
              value={modelIds}
              placeholder="model-a
model-b"
              minHeight={72}
              mono
              onChange={(e) => setModelIds(e.target.value)}
            />
          </Field>
        </>
      )}

      <Field label={t("API key")}>
        <PasswordInput
          value={apiKey}
          onChange={setApiKey}
          placeholder="sk-…"
          invalid={error !== null}
        />
      </Field>
    </Modal>
  );
}
