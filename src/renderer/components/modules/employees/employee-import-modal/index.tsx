import type { EmployeeImportPreview } from "@shared/types";
import { t } from "@shared/l10n";
import { useEffect, useState } from "react";
import { Button } from "../../../button";
import { Modal } from "../../../modal";
import { Toggle } from "../../../toggle";
import "./index.css";

export interface EmployeeImportModalProps {
  open: boolean;
  preview: EmployeeImportPreview | null;
  /** "Overwrite existing items" switch (only meaningful with conflicts). */
  overwrite: boolean;
  onOverwriteChange: (value: boolean) => void;
  /** An apply call is running. */
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

/**
 * Confirmation step of "Recruit → Import from file…".
 *
 * Everything shown here comes from the unpacked staging copy; nothing has been
 * written to the app's data yet. Confirming hands the token back to the module,
 * which applies it (asking a second time when an overwrite was requested).
 */
export function EmployeeImportModal({
  open,
  preview,
  overwrite,
  onOverwriteChange,
  busy,
  error,
  onCancel,
  onConfirm,
}: EmployeeImportModalProps): React.JSX.Element | null {
  // A data URL that the browser refuses to decode falls back to the initial
  // (never a broken image or stray alt text).
  const [avatarBroken, setAvatarBroken] = useState(false);
  const previewToken = preview?.token ?? null;
  useEffect(() => {
    setAvatarBroken(false);
  }, [previewToken]);

  if (preview === null) return null;
  const employee = preview.employee;
  const avatarSrc =
    !avatarBroken && preview.employee.avatarDataUrl !== null
      ? preview.employee.avatarDataUrl
      : null;
  const initial =
    employee.name.trim().slice(0, 1).toUpperCase() ||
    employee.name.trim().slice(0, 1) ||
    "?";
  const conflicts =
    preview.skills.filter(
      (skill) => skill.exists && skill.invalidReason === null,
    ).length + preview.mcpServers.filter((server) => server.exists).length;
  const warnings = [
    ...preview.manifest.warnings,
    ...preview.missingMcp.map((name) =>
      t("MCP server “${name}” is not in this file and not configured here.", {
        name,
      }),
    ),
    ...preview.missingSkills.map((name) =>
      t("Skill “${name}” is not in this file and not installed here.", {
        name,
      }),
    ),
    ...(preview.modelFallback !== null
      ? [
          t(
            "The model “${model}” does not exist on this machine; the employee will follow the default model.",
            { model: preview.modelFallback.from },
          ),
        ]
      : []),
  ];

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={t("Import employee")}
      size="lg"
      error={error}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button onClick={onConfirm} loading={busy}>
            {t("Import")}
          </Button>
        </>
      }
    >
      {/* `data-autofocus` + tabIndex -1: the dialog opens focused at the top
          instead of jumping to the first control near the bottom. */}
      <p className="imb-import-intro" data-autofocus tabIndex={-1}>
        {t(
          "From ${file} — exported ${date} on ${platform} with imboss ${version}.",
          {
            file: preview.sourceName,
            date: new Date(preview.manifest.createdAt).toLocaleString(),
            platform:
              PLATFORM_LABELS[preview.manifest.platform] ??
              preview.manifest.platform,
            version: preview.manifest.appVersion,
          },
        )}
      </p>

      <section className="imb-import-section">
        <h3 className="imb-import-section-title">{t("Employee")}</h3>
        <ul className="imb-import-list">
          <li className="imb-import-row">
            <div className="imb-import-row-main">
              <span className="imb-import-row-name">
                {employee.name.trim() || t("Unnamed")}
              </span>
              <span className="imb-import-row-meta">
                {employee.role.trim() || "—"}
                {employee.modelId !== null
                  ? ` · ${employee.modelId}`
                  : ` · ${t("Default model")}`}
              </span>
            </div>
            <span className="imb-import-avatar">
              {avatarSrc !== null ? (
                <img
                  className="imb-import-avatar-img"
                  src={avatarSrc}
                  alt=""
                  aria-hidden="true"
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <span className="imb-import-avatar-initial" aria-hidden="true">
                  {initial}
                </span>
              )}
            </span>
          </li>
        </ul>
      </section>

      <section className="imb-import-section">
        <h3 className="imb-import-section-title">{t("Skills")}</h3>
        {preview.skills.length === 0 ? (
          <p className="imb-import-empty">
            {t("No skill folders in this file.")}
          </p>
        ) : (
          <ul className="imb-import-list">
            {preview.skills.map((skill) => (
              <li className="imb-import-row" key={skill.name}>
                <div className="imb-import-row-main">
                  <span className="imb-import-row-name">{skill.name}</span>
                  <span className="imb-import-row-meta">
                    {t("${files} files, ${size}", {
                      files: String(skill.files),
                      size: formatBytes(skill.bytes),
                    })}
                  </span>
                </div>
                {skill.invalidReason !== null ? (
                  <span className="imb-import-badge imb-import-badge--invalid">
                    {t("Will be skipped")}
                  </span>
                ) : skill.exists ? (
                  <span className="imb-import-badge imb-import-badge--conflict">
                    {t("Already installed")}
                  </span>
                ) : (
                  <span className="imb-import-badge">{t("New")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="imb-import-section">
        <h3 className="imb-import-section-title">{t("MCP servers")}</h3>
        {preview.mcpServers.length === 0 ? (
          <p className="imb-import-empty">
            {t("No MCP servers in this file.")}
          </p>
        ) : (
          <ul className="imb-import-list">
            {preview.mcpServers.map((server) => (
              <li className="imb-import-row" key={server.name}>
                <div className="imb-import-row-main">
                  <span className="imb-import-row-name">{server.name}</span>
                  <span className="imb-import-row-meta">
                    {server.transport === "stdio" ? "stdio" : "http"}
                    {server.target.length > 0 ? ` · ${server.target}` : ""}
                  </span>
                  {server.secretKeys.length > 0 && (
                    <span className="imb-import-row-secrets">
                      {t("Needs credentials filled in after import: ${keys}", {
                        keys: server.secretKeys.join(", "),
                      })}
                    </span>
                  )}
                </div>
                {server.exists ? (
                  <span className="imb-import-badge imb-import-badge--conflict">
                    {t("Already configured")}
                  </span>
                ) : (
                  <span className="imb-import-badge">{t("New")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {warnings.length > 0 && (
        <section className="imb-import-section">
          <h3 className="imb-import-section-title">{t("Notes")}</h3>
          <ul className="imb-import-warnings">
            {warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="imb-import-overwrite">
        <Toggle
          checked={overwrite}
          onChange={onOverwriteChange}
          disabled={busy || conflicts === 0}
          label={t("Overwrite existing items")}
        />
        <div className="imb-import-overwrite-copy">
          <span>{t("Overwrite existing items")}</span>
          <span className="imb-import-overwrite-hint">
            {conflicts === 0
              ? t(
                  "Nothing to overwrite: no skill or MCP server of the same name exists here.",
                )
              : t(
                  "Replaces the ${count} skill folder(s) / MCP server(s) named above with the ones from this file. You will be asked to confirm.",
                  { count: String(conflicts) },
                )}
          </span>
        </div>
      </div>
    </Modal>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
