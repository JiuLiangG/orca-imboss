import { useState } from "react";
import type { ProviderInfo } from "../../../../../../shared/types";
import { t } from "../../../../../../shared/libs/l10n";
import { Button } from "../../../button";
import { Chip } from "../../../chip";
import { DetailBody, DetailHead } from "../../../detail-pane";
import { Field } from "../../../field";
import { Modal } from "../../../modal";
import { PasswordField } from "../../../password-field";
import "./index.css";

export interface ProviderDetailProps {
  provider: ProviderInfo;
  onRemove: () => void;
}

/** Provider detail: kind badge, custom config info, masked key + reveal. */
export function ProviderDetail({
  provider,
  onRemove,
}: ProviderDetailProps): React.JSX.Element {
  const [removeOpen, setRemoveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async (): Promise<string | null> => {
    try {
      const key = await window.imb.providers.revealKey(provider.id);
      setError(null);
      return key;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
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
          <Button
            variant="danger"
            size="sm"
            onClick={() => setRemoveOpen(true)}
          >
            {t("Remove")}
          </Button>
        }
      />
      <DetailBody>
        {provider.kind === "custom" && (
          <>
            {provider.baseUrl && (
              <Field label={t("Base URL")}>
                <span className="imb-provider-info imb-mono">
                  {provider.baseUrl}
                </span>
              </Field>
            )}
            {provider.apiType && (
              <Field label={t("API type")}>
                <span className="imb-provider-info imb-mono">
                  {provider.apiType}
                </span>
              </Field>
            )}
            {provider.modelIds.length > 0 && (
              <Field label={t("Model list")}>
                <div className="imb-provider-model-list">
                  {provider.modelIds.map((modelId) => (
                    <Chip key={modelId}>{modelId}</Chip>
                  ))}
                </div>
              </Field>
            )}
          </>
        )}
        <Field
          label={t("API key")}
          hint={
            provider.hasKey
              ? t("Key ending in ${hint}", { hint: provider.keyHint ?? "" })
              : t("No key set")
          }
        >
          <PasswordField value={masked} onReveal={reveal} />
        </Field>
        {error !== null && <p className="imb-error-text">{error}</p>}
      </DetailBody>

      <Modal
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title={t("Remove provider")}
        sub={t('Are you sure you want to remove "${name}"?', {
          name: provider.id,
        })}
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
