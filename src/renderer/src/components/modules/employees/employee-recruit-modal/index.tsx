import { useState } from "react";
import type { Employee, EmployeeInput } from "../../../../../../shared/types";
import { t } from "../../../../../../shared/libs/l10n";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Textarea } from "../../../textarea";
import { Select, type SelectOption } from "../../../select";
import { MultiSelect, type MultiSelectOption } from "../../../multi-select";
import { Modal } from "../../../modal";

export interface EmployeeRecruitModalProps {
  open: boolean;
  onClose: () => void;
  mcpOptions: MultiSelectOption[];
  skillOptions: MultiSelectOption[];
  modelOptions: SelectOption[];
  onCreate: (input: EmployeeInput) => Promise<Employee | null>;
}

/** Recruit modal: create a new employee (same fields as the detail). */
export function EmployeeRecruitModal({
  open,
  onClose,
  mcpOptions,
  skillOptions,
  modelOptions,
  onCreate,
}: EmployeeRecruitModalProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mcp, setMcp] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setName("");
    setRole("");
    setPrompt("");
    setMcp([]);
    setSkills([]);
    setModelId("");
    setError(null);
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await onCreate({
        name: name.trim() || undefined,
        role: role.trim() || undefined,
        systemPrompt: prompt,
        mcp,
        skills,
        modelId: modelId || null,
      });
      if (created) {
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
      title={t("Recruit")}
      sub={t("Create a subagent to handle specific tasks.")}
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
      <Field label={t("Name")}>
        <Input
          value={name}
          placeholder={t("Unnamed")}
          data-autofocus
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t("Role")}>
        <Input
          value={role}
          placeholder={t("e.g. Researcher")}
          onChange={(e) => setRole(e.target.value)}
        />
      </Field>
      <Field label={t("System prompt")}>
        <Textarea
          value={prompt}
          placeholder={t(
            "Define this employee's responsibilities and output standards…",
          )}
          minHeight={120}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>
      <Field label={t("Linked MCP")}>
        <MultiSelect
          value={mcp}
          options={mcpOptions}
          placeholder={t("Select MCP")}
          emptyHint={t("No MCP configured")}
          onChange={setMcp}
        />
      </Field>
      <Field label={t("Skill set")}>
        <MultiSelect
          value={skills}
          options={skillOptions}
          placeholder={t("Select skills")}
          emptyHint={t("No skills installed")}
          onChange={setSkills}
        />
      </Field>
      <Field label={t("Model")}>
        <Select
          value={modelId}
          options={[{ value: "", label: t("None") }, ...modelOptions]}
          onChange={setModelId}
        />
      </Field>
    </Modal>
  );
}
