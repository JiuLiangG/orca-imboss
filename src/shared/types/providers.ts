import { PROVIDER_API_TYPES } from "@shared/constants/providers";
import type { ModelInputType } from "@shared/constants/providers";
import type { ThinkingLevel } from "@shared/constants/thinking";

export type ProviderApiType = (typeof PROVIDER_API_TYPES)[number];

/**
 * One custom model as edited in the provider form: its id plus the input
 * (modality) capabilities it declares. `input` is restricted to Pi's schema
 * values (see `MODEL_INPUT_TYPES`), never free text.
 */
export interface ModelInputSpec {
  id: string;
  input: ModelInputType[];
}

/** Safe-to-render provider description (API keys are never included raw). */
export interface ProviderInfo {
  id: string;
  kind: "built-in" | "custom";
  label: string;
  baseUrl?: string;
  apiType?: ProviderApiType;
  /** Model ids, derived from `models` (kept for list rows / older callers). */
  modelIds: string[];
  /** One entry per model, including its declared input types. */
  models: ModelInputSpec[];
  hasKey: boolean;
  /**
   * How the stored credential authenticates. `null` when a custom provider
   * has config but no credential yet. OAuth credentials have no API key.
   */
  authType: "api_key" | "oauth" | null;
  /** Last 4 characters of a stored API key, for confirmation UI only. */
  keyHint: string | null;
}

/** Pushed while a subscription sign-in is waiting on the user. */
export interface ProviderLoginEvent {
  type: "device_code";
  userCode: string;
  verificationUri: string;
  expiresInSeconds?: number;
}

/**
 * One usable model from the app's shared ModelRuntime (see main/agent/
 * model-runtime.ts). Combines built-in (dynamic catalog) and custom providers;
 * only models whose provider has configured auth are included.
 */
export interface ModelOption {
  provider: string;
  id: string;
  name: string;
  /**
   * Thinking levels this catalog entry accepts, in Pi's order. Mirrors
   * `getSupportedThinkingLevels` in `@earendil-works/pi-ai`.
   */
  thinkingLevels: ThinkingLevel[];
}

/** Payload to add/update a provider configuration. */
export interface ProviderUpsert {
  id: string;
  kind: "built-in" | "custom";
  /** Required for custom providers; ignored for built-ins. */
  label?: string;
  baseUrl?: string;
  apiType?: ProviderApiType;
  /** Required for custom providers: one entry per model id + its input types. */
  models?: ModelInputSpec[];
  /** Omit to keep an existing key unchanged on update. */
  apiKey?: string;
}

/** Input to fetch a custom provider's available model ids (add-provider flow). */
export interface ProviderModelsQuery {
  baseUrl: string;
  apiType: ProviderApiType;
  apiKey: string;
}

export interface AuthFile {
  [providerId: string]:
    { type: "api_key"; key: string } | { type: string; [k: string]: unknown };
}

export interface ModelSpec {
  id: string;
  name: string;
  reasoning: boolean;
  input: ModelInputType[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}

export interface ProviderSpec {
  baseUrl?: string;
  api?: ProviderApiType;
  models?: ModelSpec[];
}

export interface ModelsFile {
  providers?: Record<string, ProviderSpec>;
}
