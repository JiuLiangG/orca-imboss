import { useCallback, useEffect, useRef, useState } from "react";
import { SUPPORTED_LOCALES } from "../../../../../../shared/constants";
import { t } from "../../../../../../shared/libs/l10n";
import type { ProviderInfo } from "../../../../../../shared/types";
import { useApp } from "../../../../app-store";
import { DetailBody, DetailHead } from "../../../detail-pane";
import { Field } from "../../../field";
import { IconPlus, IconTrash } from "../../../icons";
import { Input } from "../../../input";
import { Select } from "../../../select";
import "./index.css";

interface EnvVar {
  key: string;
  value: string;
}

const ENV_KEY = "env";
const DEFAULT_MODEL_KEY = "defaultModel";
const SAVE_DEBOUNCE_MS = 400;

/** Settings → General: language, default model, environment variables. */
export function SettingsGeneral(): React.JSX.Element {
  const { locale, setLocale } = useApp();
  const [defaultModel, setDefaultModel] = useState("");
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const envTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistEnv = useCallback((next: EnvVar[]): void => {
    if (envTimerRef.current) clearTimeout(envTimerRef.current);
    envTimerRef.current = setTimeout(() => {
      void window.imb.settings.set(ENV_KEY, JSON.stringify(next));
    }, SAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [defaultModelStored, envStored, providerList] = await Promise.all([
        window.imb.settings.get(DEFAULT_MODEL_KEY),
        window.imb.settings.get(ENV_KEY),
        window.imb.providers.list(),
      ]);
      if (!alive) return;
      setDefaultModel(defaultModelStored ?? "");
      setEnvVars(parseEnv(envStored));
      setProviders(providerList);
    })();
    return () => {
      alive = false;
      if (envTimerRef.current) clearTimeout(envTimerRef.current);
    };
  }, []);

  const modelOptions = providers
    .filter((p) => p.modelIds.length > 0)
    .flatMap((p) => p.modelIds.map((m) => `${p.id}/${m}`));

  const changeDefaultModel = (value: string): void => {
    setDefaultModel(value);
    void window.imb.settings.set(DEFAULT_MODEL_KEY, value);
  };

  const updateEnv = (next: EnvVar[]): void => {
    setEnvVars(next);
    persistEnv(next);
  };

  const addEnv = (): void => {
    const next = [...envVars, { key: "", value: "" }];
    updateEnv(next);
    requestAnimationFrame(() => {
      const rows =
        document.querySelectorAll<HTMLInputElement>(".imb-env-key-input");
      rows[rows.length - 1]?.focus();
    });
  };

  const removeEnv = (index: number): void => {
    updateEnv(envVars.filter((_, i) => i !== index));
  };

  return (
    <>
      <DetailHead
        eyebrow="General"
        title={t("General")}
        sub={t("App language and basic settings")}
      />
      <DetailBody>
        <Field
          label={t("App language")}
          hint={t(
            "Switch the interface language. Currently only Simplified Chinese and English are supported.",
          )}
        >
          <Select
            value={SUPPORTED_LOCALES.includes(locale) ? locale : "en"}
            options={SUPPORTED_LOCALES.map((l) => ({
              value: l,
              label: l === "zh-CN" ? "简体中文" : "English",
            }))}
            onChange={(value) => void setLocale(value)}
          />
        </Field>

        <Field
          label={t("Default model")}
          hint={t(
            "Combines models from all providers, used as the default model for new employees / tasks.",
          )}
        >
          <Select
            value={defaultModel}
            options={[
              { value: "", label: t("None") },
              ...modelOptions.map((m) => ({ value: m, label: m })),
            ]}
            onChange={changeDefaultModel}
          />
        </Field>

        <div className="imb-settings-env-section">
          <label className="imb-settings-env-title">
            {t("Environment variables")}
          </label>
          <span className="imb-settings-env-help">
            {t(
              "Provides runtime environment variables for MCP servers and agents. One key-value pair per line.",
            )}
          </span>
          <div className="imb-env-list">
            {envVars.length === 0 && (
              <span className="imb-settings-env-empty">
                {t("No environment variables configured")}
              </span>
            )}
            {envVars.map((env, index) => (
              <div className="imb-env-row" key={index}>
                <Input
                  className="imb-env-key-input imb-env-key"
                  value={env.key}
                  placeholder="KEY"
                  aria-label="KEY"
                  onChange={(e) =>
                    updateEnv(
                      envVars.map((item, i) =>
                        i === index ? { ...item, key: e.target.value } : item,
                      ),
                    )
                  }
                />
                <span className="imb-env-sep">=</span>
                <Input
                  className="imb-env-value-input"
                  value={env.value}
                  placeholder="value"
                  aria-label="value"
                  onChange={(e) =>
                    updateEnv(
                      envVars.map((item, i) =>
                        i === index ? { ...item, value: e.target.value } : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="imb-btn-icon"
                  aria-label={t("Remove environment variable")}
                  title={t("Remove environment variable")}
                  onClick={() => removeEnv(index)}
                >
                  <IconTrash className="imb-icon imb-sm" />
                </button>
              </div>
            ))}
          </div>
          <div className="imb-env-add-row">
            <button type="button" className="imb-env-add-btn" onClick={addEnv}>
              <IconPlus className="imb-icon imb-sm" />
              {t("Add environment variable")}
            </button>
          </div>
        </div>
      </DetailBody>
    </>
  );
}

function parseEnv(raw: string | null): EnvVar[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is EnvVar =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as EnvVar).key === "string" &&
          typeof (item as EnvVar).value === "string",
      )
      .map((item) => ({ key: item.key, value: item.value }));
  } catch {
    return [];
  }
}
