import {
  DEFAULT_MODEL_INPUT_TYPES,
  MODEL_INPUT_TYPES,
  PROVIDER_API_TYPES,
} from "@shared/constants/providers";
import type { ModelInputType } from "@shared/constants/providers";
import { t } from "@shared/l10n";
import type {
  ModelInputSpec,
  ProviderApiType,
  ProviderModelsQuery,
} from "@shared/types";
import { useState } from "react";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { IconButton } from "../../../icon-button";
import { IconPlus, IconTrash } from "../../../icons";
import { Input } from "../../../input";
import { MultiSelect, type MultiSelectOption } from "../../../multi-select";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";
import "./index.css";

/**
 * Custom-provider config fields (API type / base URL / models + fetch), shared
 * by the add modal and the detail pane (mirrors mcp-config-fields).
 *
 * Models are edited as a row list — one row per model id with a multi-select of
 * the input (modality) capabilities that model declares. The textarea stays as
 * a **batch staging area**: pasted ids are merged into the list by the "Add
 * models" button (and again defensively on submit), so nothing typed is lost.
 *
 * The API key is intentionally not part of this form: the add modal edits it
 * directly while the detail pane shows a masked readout plus a separate
 * "new key" input. Callers pass the currently typed key only so the
 * "Fetch models" request can authenticate.
 */

export interface ProviderConfigFormValue {
  apiType: ProviderApiType;
  baseUrl: string;
  /** Raw "one model id per line" staging text, merged into `models`. */
  modelIds: string;
  /** Authoritative model list (id + declared input types). */
  models: ModelInputSpec[];
}

export const EMPTY_PROVIDER_CONFIG: ProviderConfigFormValue = {
  apiType: "openai-completions",
  baseUrl: "",
  modelIds: "",
  models: [],
};

/** Input types offered per model row (labels are the raw API values). */
const MODEL_INPUT_OPTIONS: MultiSelectOption[] = MODEL_INPUT_TYPES.map(
  (type) => ({ value: type, label: type }),
);

/**
 * Stored/declared input types in canonical order, dropping unknown values.
 * Returns `[]` when nothing valid remains — callers decide the fallback (read
 * path) or reject the value (write path).
 */
export function orderModelInputs(input: unknown): ModelInputType[] {
  if (!Array.isArray(input)) return [];
  const declared = new Set(
    input.filter((value): value is ModelInputType =>
      MODEL_INPUT_TYPES.includes(value as ModelInputType),
    ),
  );
  return MODEL_INPUT_TYPES.filter((type) => declared.has(type));
}

/** Read-path normalization: an unreadable/missing value means "text only". */
export function normalizeModelInputs(input: unknown): ModelInputType[] {
  const ordered = orderModelInputs(input);
  return ordered.length > 0 ? ordered : [...DEFAULT_MODEL_INPUT_TYPES];
}

export function providerConfigToForm(provider: {
  apiType?: ProviderApiType;
  baseUrl?: string;
  models: ModelInputSpec[];
}): ProviderConfigFormValue {
  return {
    apiType: provider.apiType ?? "openai-completions",
    baseUrl: provider.baseUrl ?? "",
    modelIds: "",
    models: provider.models.map((model) => ({
      id: model.id,
      input: normalizeModelInputs(model.input),
    })),
  };
}

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

/**
 * Merge ids into the model list: existing entries keep their declared input
 * types, new ones start from the default. Order is preserved (existing first),
 * so a fetch never reorders or drops what the user configured.
 */
function addModelIds(
  models: ModelInputSpec[],
  ids: readonly string[],
): ModelInputSpec[] {
  const next = [...models];
  const known = new Set(models.map((model) => model.id.trim()));
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || known.has(id)) continue;
    known.add(id);
    next.push({ id, input: [...DEFAULT_MODEL_INPUT_TYPES] });
  }
  return next;
}

export interface ResolvedProviderModels {
  models: ModelInputSpec[];
  /** User-facing message when the list cannot be saved; `null` when valid. */
  error: string | null;
}

/**
 * Merge the staging textarea, trim ids, drop blank rows, normalize the input
 * types and validate. Shared by both callers so the persisted payload and the
 * local echo can never disagree. Never silently coerces a missing input
 * selection — the main process would reject it anyway.
 */
export function resolveProviderModels(
  value: ProviderConfigFormValue,
): ResolvedProviderModels {
  const merged = addModelIds(value.models, parseModelIds(value.modelIds));
  const models: ModelInputSpec[] = [];
  const seen = new Set<string>();
  for (const model of merged) {
    const id = model.id.trim();
    if (!id) continue; // an empty row carries nothing
    if (seen.has(id)) {
      return { models, error: t("Duplicate model id: ${id}", { id }) };
    }
    seen.add(id);
    const input = orderModelInputs(model.input);
    if (input.length === 0) {
      return {
        models,
        error: t("Each model needs at least one input type."),
      };
    }
    models.push({ id, input });
  }
  if (models.length === 0) {
    return { models, error: t("At least one model ID is required.") };
  }
  return { models, error: null };
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

  const updateModel = (index: number, patch: Partial<ModelInputSpec>): void => {
    onChange({
      ...value,
      models: value.models.map((model, i) =>
        i === index ? { ...model, ...patch } : model,
      ),
    });
  };

  const removeModel = (index: number): void => {
    onChange({
      ...value,
      models: value.models.filter((_model, i) => i !== index),
    });
  };

  const addModels = (ids: readonly string[]): void => {
    onChange({ ...value, models: addModelIds(value.models, ids) });
  };

  /** Append one blank row for an id that is typed in place. */
  const addEmptyModel = (): void => {
    onChange({
      ...value,
      models: [
        ...value.models,
        { id: "", input: [...DEFAULT_MODEL_INPUT_TYPES] },
      ],
    });
  };

  const addPendingModels = (): void => {
    addModels(parseModelIds(value.modelIds));
    set({ modelIds: "" });
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
      // Union merge: models already in the list keep their input types, ids the
      // provider no longer returns are left untouched (never silently dropped).
      onChange({ ...value, models: addModelIds(value.models, models) });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  };

  const pendingIds = parseModelIds(value.modelIds);

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
        label={t("Models")}
        hint={t("Each model declares the input types it accepts.")}
      >
        <div className="imb-model-rows">
          {value.models.map((model, index) => (
            <div className="imb-model-row" key={index}>
              <Input
                className="imb-model-row-id"
                value={model.id}
                mono
                placeholder="model-id"
                aria-label={t("Model id")}
                onChange={(e) => updateModel(index, { id: e.target.value })}
              />
              <MultiSelect
                className="imb-model-row-input"
                value={model.input}
                options={MODEL_INPUT_OPTIONS}
                placeholder={t("Select input types")}
                emptyHint={t("No input types")}
                onChange={(input) =>
                  updateModel(index, { input: orderModelInputs(input) })
                }
              />
              <IconButton
                label={t("Remove model")}
                size={16}
                boxSize={28}
                onClick={() => removeModel(index)}
              >
                <IconTrash className="imb-icon imb-sm" />
              </IconButton>
            </div>
          ))}
          {value.models.length === 0 && (
            <p className="imb-model-rows-empty">{t("No models added yet.")}</p>
          )}
          <div className="imb-model-add-row">
            <button
              type="button"
              className="imb-model-add-btn"
              onClick={addEmptyModel}
            >
              <IconPlus className="imb-icon imb-sm" />
              {t("Add model")}
            </button>
          </div>
        </div>
      </Field>
      <Field
        label={t("Model ids (one per line)")}
        htmlFor={`${idPrefix}-model-ids`}
        hint={t("Paste ids to add several models at once.")}
      >
        <Textarea
          id={`${idPrefix}-model-ids`}
          value={value.modelIds}
          placeholder={"gpt-4o\nanthropic/claude-sonnet-4.5"}
          minHeight={72}
          mono
          onChange={(e) => set({ modelIds: e.target.value })}
        />
        <div className="imb-model-fetch-row">
          <Button
            variant="secondary"
            size="sm"
            disabled={pendingIds.length === 0 || fetching}
            onClick={addPendingModels}
          >
            {t("Add models")}
          </Button>
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
