import { t } from "@shared/l10n";
import type { McpServerInput } from "@shared/types";
import { useState } from "react";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { Textarea } from "../../../textarea";
import {
  formToConfig,
  McpConfigFields,
  type McpConfigFormValue,
} from "../mcp-config-fields";

export interface McpAddModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: McpServerInput) => Promise<boolean>;
}

const EMPTY_FORM: McpConfigFormValue = {
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  kv: "",
};

export function McpAddModal({
  open,
  onClose,
  onCreate,
}: McpAddModalProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [form, setForm] = useState<McpConfigFormValue>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setName("");
    setDescription("");
    setForm(EMPTY_FORM);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (!name.trim()) {
      setError(t("Please enter the MCP name."));
      return;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      setError(t("stdio transport requires a command."));
      return;
    }
    if (form.transport !== "stdio" && !form.url.trim()) {
      setError(t("This transport requires a server URL."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onCreate({
        name: name.trim(),
        description,
        config: formToConfig(form),
      });
      if (ok) {
        reset();
        onClose();
      }
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
      title={t("Add MCP Server")}
      sub={t("Configure and connect a new MCP server.")}
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
            {t("Create")}
          </Button>
        </>
      }
    >
      <Field label={t("MCP name")}>
        <Input
          value={name}
          placeholder={t("e.g. Web Search")}
          data-autofocus
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t("Description")}>
        <Textarea
          value={description}
          placeholder={t("Describe what this MCP does…")}
          minHeight={72}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <McpConfigFields idPrefix="mcp-new" value={form} onChange={setForm} />
    </Modal>
  );
}
