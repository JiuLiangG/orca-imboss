import { PROVIDER_API_TYPES } from "@shared/constants/providers";
import { t } from "@shared/l10n";
import type { ProviderApiType, ProviderModelsQuery } from "@shared/types";
import { useState } from "react";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";
import "./index.css";

/**
 * Custom-provider config fields (API type / base URL / model ids + fetch),
 * shared by the add modal and the detail pane (mirrors mcp-config-fields).
 *
 * The API key is intentionally not part of this form: the add modal edits it
 * directly while the detail pane shows a masked readout plus a separate
 * "new key" input. Callers pass the currently typed key only so the
 * "Fetch models" request can authenticate.
 */

export interface ProviderConfigFormValue {
  apiType: ProviderApiType;
  baseUrl: string;
  /** Raw "one model id per line" text. */
  modelIds: string;
}

export const EMPTY_PROVIDER_CONFIG: ProviderConfigFormValue = {
  apiType: "openai-completions",
  baseUrl: "",
  modelIds: "",
};

export function providerConfigToForm(provider: {
  apiType?: ProviderApiType;
  baseUrl?: string;
  modelIds: string[];
}): ProviderConfigFormValue {
  return {
    apiType: provider.apiType ?? "openai-completions",
    baseUrl: provider.baseUrl ?? "",
    modelIds: provider.modelIds.join("\n"),
  };
}

/** Parse the textarea into a de-duplicated list of non-empty model ids. */
export function parseModelIds(value: string): string[] {
  const ids = new Set<string>();
  for (const raw of value.split(/[\n,]/)) {
    const id = raw.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/** True for a valid `http(s)` URL (defensive mirror of the main-process check). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export interface ProviderConfigFieldsProps {
  value: ProviderConfigFormValue;
  onChange: (value: ProviderConfigFormValue) => void;
  idPrefix: string;
  /** Currently typed API key, used only for the "Fetch models" request. */
  apiKey: string;
  /** Fetch the provider's model ids (IPC call owned by the caller). */
  onFetchModels: (query: ProviderModelsQuery) => Promise<string[]>;
}

export function ProviderConfigFields({
  value,
  onChange,
  idPrefix,
  apiKey,
  onFetchModels,
}: ProviderConfigFieldsProps): React.JSX.Element {
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const set = (patch: Partial<ProviderConfigFormValue>): void => {
    onChange({ ...value, ...patch });
    setFetchError(null);
  };

  const fetchModels = async (): Promise<void> => {
    if (fetching) return;
    const baseUrl = value.baseUrl.trim();
    if (!baseUrl) {
      setFetchError(t("Enter the base URL first."));
      return;
    }
    const key = apiKey.trim();
    if (!key) {
      setFetchError(t("Enter the API key first."));
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const models = await onFetchModels({
        baseUrl,
        apiType: value.apiType,
        apiKey: key,
      });
      if (models.length === 0) {
        setFetchError(t("No models returned."));
        return;
      }
      onChange({ ...value, modelIds: models.join("\n") });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  };

  return (
    <>
      <Field label={t("API type")} htmlFor={`${idPrefix}-api-type`}>
        <Select
          id={`${idPrefix}-api-type`}
          value={value.apiType}
          options={PROVIDER_API_TYPES.map((type) => ({
            value: type,
            label: type,
          }))}
          onChange={(next) => set({ apiType: next as ProviderApiType })}
        />
      </Field>
      <Field label={t("Base URL")} htmlFor={`${idPrefix}-base-url`}>
        <Input
          id={`${idPrefix}-base-url`}
          value={value.baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(e) => set({ baseUrl: e.target.value })}
        />
      </Field>
      <Field
        label={t("Model ids (one per line)")}
        htmlFor={`${idPrefix}-model-ids`}
      >
        <Textarea
          id={`${idPrefix}-model-ids`}
          value={value.modelIds}
          placeholder={"model-a\nmodel-b"}
          minHeight={72}
          mono
          onChange={(e) => set({ modelIds: e.target.value })}
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
  );
}
