import { t } from "@shared/l10n";
import type { McpServer, McpServerInput } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../button";
import { DetailBody } from "../../../detail-pane/detail-body";
import { DetailHead } from "../../../detail-pane/detail-head";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { Textarea } from "../../../textarea";
import {
  configToForm,
  formToConfig,
  McpConfigFields,
  type McpConfigFormValue,
} from "../mcp-config-fields";

export interface McpDetailProps {
  server: McpServer;
  onPatch: (input: McpServerInput) => Promise<void>;
  onRemove: () => void;
}

const SAVE_DEBOUNCE_MS = 400;

/** MCP detail: name/desc/transport + transport-specific config fields. */
export function McpDetail({
  server,
  onPatch,
  onRemove,
}: McpDetailProps): React.JSX.Element {
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [configForm, setConfigForm] = useState<McpConfigFormValue>(() =>
    configToForm(server.config),
  );
  const [removeOpen, setRemoveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    (next: { name: string; description: string; form: McpConfigFormValue }) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void onPatch({
          name: next.name,
          description: next.description,
          config: formToConfig(next.form),
        }).catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
      }, SAVE_DEBOUNCE_MS);
    },
    [onPatch],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const updateName = (value: string): void => {
    setName(value);
    save({ name: value, description, form: configForm });
  };
  const updateDescription = (value: string): void => {
    setDescription(value);
    save({ name, description: value, form: configForm });
  };
  const updateConfig = (form: McpConfigFormValue): void => {
    setConfigForm(form);
    save({ name, description, form });
  };

  return (
    <>
      <DetailHead
        eyebrow="MCP Server"
        title={name.trim() || t("Unnamed MCP")}
        sub={description.split("\n")[0] || "—"}
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
        <Field label={t("MCP name")}>
          <Input value={name} onChange={(e) => updateName(e.target.value)} />
        </Field>
        <Field label={t("Description")}>
          <Textarea
            value={description}
            minHeight={72}
            onChange={(e) => updateDescription(e.target.value)}
          />
        </Field>
        <McpConfigFields
          idPrefix={`mcp-${server.id}`}
          value={configForm}
          onChange={updateConfig}
        />
        {error !== null && <p className="imb-error-text">{error}</p>}
      </DetailBody>

      <Modal
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title={t("Delete MCP")}
        sub={t('Are you sure you want to delete "${name}"?', {
          name: name.trim() || server.name,
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
        <p className="imb-mcp-remove-note">
          {t(
            "The configuration will be permanently deleted. Linked employees must choose again.",
          )}
        </p>
      </Modal>
    </>
  );
}
