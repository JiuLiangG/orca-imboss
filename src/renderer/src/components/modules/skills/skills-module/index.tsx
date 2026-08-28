import { useCallback, useEffect, useState } from "react";
import type { InstalledSkill } from "../../../../../../shared/types";
import { t } from "../../../../../../shared/libs/l10n";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { EmptyState } from "../../../empty-state";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { SearchInput } from "../../../search-input";
import { Button } from "../../../button";
import { DetailBody, DetailHead } from "../../../detail-pane";
import { Modal } from "../../../modal";
import "../../module-common.css";

/** Skills module: read-only list/detail + folder import + uninstall. */
export function SkillsModule(): React.JSX.Element {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledSkill | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await window.imb.skills.list();
      setSkills(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    return window.imb.skills.onChanged(() => void refresh());
  }, [refresh]);

  const importFromFolder = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.imb.skills.install();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async (skill: InstalledSkill): Promise<void> => {
    setBusy(true);
    try {
      await window.imb.skills.uninstall(skill.name);
      setUninstallTarget(null);
      if (selectedName === skill.name) setSelectedName(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const filtered = skills.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q)
    );
  });

  const selected = skills.find((s) => s.name === selectedName) ?? null;

  const list = (
    <ListPane
      title={t("Skills")}
      search={
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("Filter by skill name or description")}
        />
      }
      footer={
        <Button block loading={busy} onClick={() => void importFromFolder()}>
          {t("Import")}
        </Button>
      }
    >
      {loading ? (
        <EmptyState>{t("Loading…")}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>{t("No matching skills")}</EmptyState>
      ) : (
        filtered.map((skill) => (
          <ListRow
            key={skill.name}
            active={skill.name === selectedName}
            avatar={
              <Avatar letter={skill.name.slice(0, 1)} name={skill.name} alt />
            }
            name={skill.name}
            sub={skill.description ?? "—"}
            onClick={() => setSelectedName(skill.name)}
          />
        ))
      )}
    </ListPane>
  );

  const detail = selected ? (
    <>
      <DetailHead
        eyebrow="Skill"
        title={selected.name}
        actions={
          <Button
            variant="danger"
            size="sm"
            loading={busy}
            onClick={() => setUninstallTarget(selected)}
          >
            {t("Uninstall")}
          </Button>
        }
      />
      <DetailBody>
        <DetailReadOnlyDescription description={selected.description} />
      </DetailBody>
    </>
  ) : (
    <div className="imb-detail-scroll">
      <div className="imb-chat-empty-detail">{t("No matching skills")}</div>
    </div>
  );

  return (
    <>
      <ModuleView list={list} detail={detail} />
      <Modal
        open={uninstallTarget !== null}
        onClose={() => setUninstallTarget(null)}
        title={t("Uninstall skill")}
        sub={t('Are you sure you want to uninstall "${name}"?', {
          name: uninstallTarget?.name ?? "",
        })}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setUninstallTarget(null)}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                if (uninstallTarget) void uninstall(uninstallTarget);
              }}
            >
              {t("Uninstall")}
            </Button>
          </>
        }
      >
        <p className="imb-skills-uninstall-note">
          {t("The skill directory will be removed from the local environment.")}
        </p>
      </Modal>
      {error !== null && (
        <p className="imb-error-text imb-module-error">{error}</p>
      )}
    </>
  );
}

/** Skill info is read-only (SKILL.md is the source of truth). */
function DetailReadOnlyDescription({
  description,
}: {
  description: string | null;
}): React.JSX.Element {
  return (
    <div className="imb-skill-readonly">
      <div className="imb-skill-readonly-label">{t("Description")}</div>
      <p className="imb-skill-readonly-text">
        {description && description.length > 0 ? description : "—"}
      </p>
    </div>
  );
}
