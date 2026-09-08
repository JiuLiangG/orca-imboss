import { PROVIDER_API_TYPES } from "@shared/constants/providers";

export type ProviderApiType = (typeof PROVIDER_API_TYPES)[number];

/** Safe-to-render provider description (API keys are never included raw). */
export interface ProviderInfo {
  id: string;
  kind: "built-in" | "custom";
  label: string;
  baseUrl?: string;
  apiType?: ProviderApiType;
  modelIds: string[];
  hasKey: boolean;
  /** Last 4 characters of the stored key, for confirmation UI only. */
  keyHint: string | null;
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
}

/** Payload to add/update a provider configuration. */
export interface ProviderUpsert {
  id: string;
  kind: "built-in" | "custom";
  /** Required for custom providers; ignored for built-ins. */
  label?: string;
  baseUrl?: string;
  apiType?: ProviderApiType;
  modelIds?: string[];
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
  input: string[];
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
