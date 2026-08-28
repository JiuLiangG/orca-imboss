import { useCallback, useEffect, useRef, useState } from "react";
import type { Employee, EmployeeInput } from "../../../../../../shared/types";
import { t } from "../../../../../../shared/libs/l10n";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Textarea } from "../../../textarea";
import { Select, type SelectOption } from "../../../select";
import { MultiSelect, type MultiSelectOption } from "../../../multi-select";
import { DetailBody, DetailHead } from "../../../detail-pane";
import { Modal } from "../../../modal";
import { IconCamera } from "../../../icons";
import "./index.css";

export interface EmployeeDetailProps {
  employee: Employee;
  mcpOptions: MultiSelectOption[];
  skillOptions: MultiSelectOption[];
  modelOptions: SelectOption[];
  onPatch: (input: EmployeeInput) => Promise<boolean>;
  onRemove: () => void;
}

const SAVE_DEBOUNCE_MS = 400;

/** Employee detail: avatar upload + editable profile (live-apply, debounced). */
export function EmployeeDetail({
  employee,
  mcpOptions,
  skillOptions,
  modelOptions,
  onPatch,
  onRemove,
}: EmployeeDetailProps): React.JSX.Element {
  const [form, setForm] = useState<EmployeeInput>({
    name: employee.name,
    role: employee.role,
    systemPrompt: employee.systemPrompt,
    mcp: employee.mcp,
    skills: employee.skills,
    modelId: employee.modelId ?? "",
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(employee.avatarUrl);
  const [avatarAv, setAvatarAv] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(
    (next: EmployeeInput): void => {
      setForm(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void onPatch(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [onPatch],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onAvatarPicked = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const ext = file.name.includes(".") ? file.name.split(".").pop()! : "png";
    setAvatarAv(true);
    setAvatarError(null);
    try {
      const buffer = await file.arrayBuffer();
      const updated = await window.imb.employees.updateAvatar(
        employee.id,
        ext,
        new Uint8Array(buffer),
      );
      if (updated) {
        setAvatarUrl(updated.avatarUrl);
      }
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : String(err));
    } finally {
      setAvatarAv(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const triggerPicker = (): void => fileRef.current?.click();

  const displayName = (form.name ?? "").trim() || employee.name || t("Unnamed");

  return (
    <>
      <DetailHead
        eyebrow="Employee · Team"
        title={displayName}
        sub={form.role || "—"}
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
        <div className="imb-detail-avatar-row">
          <div
            className="imb-detail-avatar-wrap"
            role="button"
            tabIndex={0}
            aria-label={t("Change avatar")}
            onClick={triggerPicker}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                triggerPicker();
              }
            }}
          >
            {avatarUrl ? (
              <img
                className="imb-detail-avatar-img"
                src={avatarUrl}
                alt={displayName}
              />
            ) : (
              <div className="imb-detail-avatar-placeholder">
                {displayName.slice(0, 1).toUpperCase() || "?"}
              </div>
            )}
            <div className="imb-detail-avatar-overlay">
              <IconCamera />
            </div>
          </div>
          <div className="imb-detail-avatar-info">
            <h2>{displayName}</h2>
            <div className="imb-sub">{form.role || "—"}</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            disabled={avatarAv}
            onChange={(e) => void onAvatarPicked(e.target.files?.[0])}
          />
        </div>
        {avatarError !== null && (
          <p className="imb-error-text imb-employee-avatar-error">
            {avatarError}
          </p>
        )}

        <div className="imb-field-row">
          <Field label={t("Name")} htmlFor={`emp-name-${employee.id}`}>
            <Input
              id={`emp-name-${employee.id}`}
              value={form.name ?? ""}
              placeholder={t("Unnamed")}
              onChange={(e) => scheduleSave({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label={t("Role")} htmlFor={`emp-role-${employee.id}`}>
            <Input
              id={`emp-role-${employee.id}`}
              value={form.role ?? ""}
              placeholder={t("e.g. Researcher")}
              onChange={(e) => scheduleSave({ ...form, role: e.target.value })}
            />
          </Field>
        </div>

        <Field label={t("System prompt")} htmlFor={`emp-prompt-${employee.id}`}>
          <Textarea
            id={`emp-prompt-${employee.id}`}
            value={form.systemPrompt ?? ""}
            placeholder={t(
              "Define this employee's responsibilities and output standards…",
            )}
            minHeight={120}
            onChange={(e) =>
              scheduleSave({ ...form, systemPrompt: e.target.value })
            }
          />
        </Field>

        <Field label={t("Linked MCP")}>
          <MultiSelect
            value={form.mcp ?? []}
            options={mcpOptions}
            placeholder={t("Select MCP")}
            emptyHint={t("No MCP configured")}
            onChange={(mcp) => scheduleSave({ ...form, mcp })}
          />
        </Field>

        <Field label={t("Skill set")}>
          <MultiSelect
            value={form.skills ?? []}
            options={skillOptions}
            placeholder={t("Select skills")}
            emptyHint={t("No skills installed")}
            onChange={(skills) => scheduleSave({ ...form, skills })}
          />
        </Field>

        <Field label={t("Model")} htmlFor={`emp-model-${employee.id}`}>
          <Select
            id={`emp-model-${employee.id}`}
            value={form.modelId ?? ""}
            options={[{ value: "", label: t("None") }, ...modelOptions]}
            placeholder={t("None")}
            onChange={(modelId) =>
              scheduleSave({ ...form, modelId: modelId || null })
            }
          />
        </Field>
      </DetailBody>

      <Modal
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title={t("Delete employee")}
        sub={t('Are you sure you want to delete employee "${name}"?', {
          name: displayName,
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
              {t("Delete")}
            </Button>
          </>
        }
      >
        <p className="imb-employee-delete-note">
          {t(
            "The employee's conversation records will also be cleared. This cannot be undone.",
          )}
        </p>
      </Modal>
    </>
  );
}
