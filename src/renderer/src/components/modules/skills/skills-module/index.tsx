import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../../../shared/libs/l10n";
import type {
  InstalledSkill,
  PageQuery,
  PageResult,
} from "../../../../../../shared/types";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import { ContextMenu, type ContextMenuState } from "../../../context-menu";
import { DetailBody, DetailHead } from "../../../detail-pane";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import { SearchInput } from "../../../search-input";
import { useInfiniteList } from "../../../useInfiniteList";
import { useMultiSelect } from "../../../useMultiSelect";
import "../../module-common.css";
import "./index.css";

const PAGE_SIZE = 50;

/** Skills module: read-only list/detail + folder import + uninstall. */
export function SkillsModule(): React.JSX.Element {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledSkill | null>(
    null,
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const fetchPage = useCallback(
    (page: PageQuery): Promise<PageResult<InstalledSkill>> =>
      window.imb.skills.listPage(page),
    [],
  );
  const {
    items: skills,
    loading,
    loadingMore,
    hasMore,
    error: listError,
    loadMore,
    reset,
    mutate,
    resetVersion,
  } = useInfiniteList(fetchPage, { query, pageSize: PAGE_SIZE });

  // Re-list when skills change outside this module (install dialog, tools).
  useEffect(() => {
    return window.imb.skills.onChanged(() => reset());
  }, [reset]);

  const multi = useMultiSelect<InstalledSkill, string>({
    getKey: (skill) => skill.name,
    items: skills,
    onActivate: (skill) => setSelectedName(skill.name),
    resetVersion,
  });

  // Auto-select the first skill after page 1 loads (and recover when the
  // selected skill disappears, e.g. uninstall).
  useEffect(() => {
    if (loading) return;
    if (skills.length === 0) {
      setSelectedName(null);
      return;
    }
    setSelectedName((current) =>
      current !== null && skills.some((skill) => skill.name === current)
        ? current
        : skills[0].name,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, loading]);

  const importFromFolder = async (): Promise<void> => {
    setBusy(true);
    try {
      const names = await window.imb.skills.install();
      // `null` = user cancelled; `[]` = nothing importable. Best-effort import:
      // keep any valid skills with no UI feedback beyond re-listing them.
      if (names !== null && names.length > 0) {
        // Newest names sort last (name ASC, in-memory source) — refresh so
        // the imported skills appear in their correct position.
        reset();
      }
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
      mutate((current) => current.filter((s) => s.name !== skill.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const uninstallSelected = async (): Promise<void> => {
    const names = [...multi.selectedKeys];
    if (names.length === 0) return;
    setBusy(true);
    try {
      for (const name of names) {
        await window.imb.skills.uninstall(name);
      }
      setBulkOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleSelectAll = useCallback((): void => {
    if (multi.selectedKeys.size === skills.length && skills.length > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, skills.length]);

  const selected = skills.find((skill) => skill.name === selectedName) ?? null;

  const listPane = (
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
          {t("Import Skills")}
        </Button>
      }
    >
      <ItemList
        items={skills}
        getItemKey={(skill) => skill.name}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        loadMore={() => void loadMore()}
        loadError={listError}
        selectable
        selectedKeys={multi.selectedKeys}
        onItemClick={(skill, index, mods) =>
          multi.onItemClick(skill, index, mods)
        }
        renderItem={(skill, { selected: isSelectedRow }) => (
          <ListRow
            active={skill.name === selectedName}
            selected={isSelectedRow}
            avatar={
              <Avatar letter={skill.name.slice(0, 1)} name={skill.name} alt />
            }
            name={skill.name}
            sub={skill.description ?? "—"}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    key: "select-all",
                    label: t("Select all"),
                    onSelect: toggleSelectAll,
                  },
                  {
                    key: "uninstall",
                    label: t("Uninstall"),
                    danger: true,
                    onSelect: () => {
                      if (multi.selectedKeys.size === 0) multi.selectAll();
                      setBulkOpen(true);
                    },
                  },
                ],
              });
            }}
          />
        )}
      />
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
      <DetailBody style={{ paddingTop: "0" }}>
        <DetailReadOnlyDescription description={selected.description} />
      </DetailBody>
    </>
  ) : null;

  return (
    <>
      <ModuleView list={listPane} detail={detail} />
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      <Modal
        open={uninstallTarget !== null}
        onClose={() => setUninstallTarget(null)}
        title={t("Uninstall skill")}
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
        <p className="imb-module-note">
          {t("The skill directory will be removed from the local environment.")}
        </p>
      </Modal>
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t("Uninstall skills")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => void uninstallSelected()}
            >
              {t("Uninstall")}
            </Button>
          </>
        }
      >
        <p className="imb-module-note">
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
    <p className="imb-skill-readonly-text">
      {description && description.length > 0 ? description : "—"}
    </p>
  );
}
