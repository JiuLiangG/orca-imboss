import {
  MAX_PROJECTS,
  MAX_PROJECT_NAME_LENGTH,
  normalizeProjectName,
  serializeCommonProjects,
} from "@shared/constants/projects";
import { SettingKeys } from "@shared/constants/settings";
import { t } from "@shared/l10n";
import type { CommonProject, CommonProjectFolder } from "@shared/types";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useRef, useState } from "react";
import { cls } from "reactutils";
import { DetailBody } from "../../../detail-pane/detail-body";
import { DetailHead } from "../../../detail-pane/detail-head";
import { IconPlus, IconTrash } from "../../../icons";
import { Input } from "../../../input";
import { TagSelect } from "../../../tag-select";
import "../../module-common.css";
import "./index.css";

/** Matches the env-vars editor: coalesce rapid edits into one write. */
const SAVE_DEBOUNCE_MS = 400;

/**
 * Settings › Common projects — the shortlist applied from the composer's
 * attach menu. Each row is a name plus an optional folder (chosen through the
 * native picker; paths are minted by main) and an optional tag set. Rows are
 * reorderable; edits auto-save (debounced) and invalid rows (empty name, no
 * folder and no tags, duplicate name) are never written.
 */
export function SettingsProjects(): React.JSX.Element {
  const [projects, setProjects] = useState<CommonProject[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest edited rows, read by the unmount flush (a ref, not state, so the
  // unmount effect never needs to re-subscribe).
  const latestRef = useRef<CommonProject[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Load the stored projects + the tag candidates once. Both streams never
  // throw (main normalizes), but guard for IPC failures all the same.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [stored, tags] = await Promise.all([
          imb.projects.list(),
          imb.tags.list(),
        ]);
        if (!alive) return;
        setProjects(stored);
        setTagOptions(tags);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Persist the valid rows (invalid ones stay in the editor so the user can
   * fix them); the stored copy always uses normalized names. `report` is false
   * during unmount, where no component is left to show an error.
   */
  const persist = useCallback(
    (rows: readonly CommonProject[], report: boolean): void => {
      const valid = rows
        .filter((project) => projectError(project, rows) === null)
        .map((project) => ({
          ...project,
          name: normalizeProjectName(project.name),
        }));
      const write = imb.settings.set(
        SettingKeys.CommonProjects,
        serializeCommonProjects(valid),
      );
      if (report) {
        void write.catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
      } else {
        void write.catch(() => {
          // Unmounted: nothing to surface the error on.
        });
      }
    },
    [],
  );

  /**
   * Apply a local edit and schedule a debounced save. The latest rows are
   * kept in a ref so a quick switch away flushes the pending edit rather than
   * dropping it.
   */
  const update = useCallback(
    (next: CommonProject[]): void => {
      setProjects(next);
      latestRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        persist(next, true);
      }, SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  // Flush a pending debounced save when the section unmounts.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        persist(latestRef.current, false);
      }
    };
  }, [persist]);

  function addProject(): void {
    setError(null);
    if (projects.length >= MAX_PROJECTS) {
      setError(
        t("At most ${count} common projects.", { count: String(MAX_PROJECTS) }),
      );
      return;
    }
    update([
      ...projects,
      { id: newProjectId(), name: "", folder: null, tags: [] },
    ]);
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(
        ".imb-project-name-input",
      );
      inputs[inputs.length - 1]?.focus();
    });
  }

  function removeProject(id: string): void {
    update(projects.filter((project) => project.id !== id));
  }

  async function chooseFolder(id: string): Promise<void> {
    setError(null);
    try {
      const directories = await imb.files.chooseDirectories();
      if (!directories || directories.length === 0) return;
      // A project carries a single folder; take the first picked directory.
      const directory = directories[0];
      update(
        projects.map((project) =>
          project.id === id
            ? {
                ...project,
                folder: { name: directory.name, path: directory.path },
              }
            : project,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = projects.findIndex((project) => project.id === active.id);
    const to = projects.findIndex((project) => project.id === over.id);
    if (from < 0 || to < 0) return;
    update(arrayMove(projects, from, to));
  }

  return (
    <>
      <DetailHead
        eyebrow="Settings"
        title={t("Common projects")}
        sub={t("Folders and tags applied to a new conversation")}
      />
      <DetailBody>
        <p className="imb-projects-help">
          {t(
            "Pick a common project from the composer's attach menu to attach its folder and add its tags to the conversation in one click.",
          )}
        </p>

        {loaded && projects.length === 0 && (
          <span className="imb-projects-empty">
            {t("No common projects yet")}
          </span>
        )}

        {projects.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={projects.map((project) => project.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="imb-project-list">
                {projects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    error={projectError(project, projects)}
                    tagOptions={tagOptions}
                    onNameChange={(name) =>
                      update(
                        projects.map((item) =>
                          item.id === project.id ? { ...item, name } : item,
                        ),
                      )
                    }
                    onFolderChange={(folder) =>
                      update(
                        projects.map((item) =>
                          item.id === project.id ? { ...item, folder } : item,
                        ),
                      )
                    }
                    onTagsChange={(tags) =>
                      update(
                        projects.map((item) =>
                          item.id === project.id ? { ...item, tags } : item,
                        ),
                      )
                    }
                    onChooseFolder={() => void chooseFolder(project.id)}
                    onRemove={() => removeProject(project.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="imb-project-add-row">
          <button
            type="button"
            className="imb-project-add-btn"
            onClick={addProject}
          >
            <IconPlus className="imb-icon imb-sm" />
            {t("Add project")}
          </button>
        </div>

        {error !== null && (
          <p className="imb-error-text imb-module-error">{error}</p>
        )}
      </DetailBody>
    </>
  );
}

/** Validation shared by the editor and the save filter. */
function projectError(
  project: CommonProject,
  all: readonly CommonProject[],
): string | null {
  const name = normalizeProjectName(project.name);
  if (name.length === 0) return t("A project needs a name.");
  const duplicate = all.some(
    (other) => other !== project && normalizeProjectName(other.name) === name,
  );
  if (duplicate) return t("A project with this name already exists.");
  if (project.folder === null && project.tags.length === 0) {
    return t("A project needs a folder or at least one tag.");
  }
  return null;
}

/** Stable id source. Uses `crypto.randomUUID` when available (renderer). */
let projectSeq = 0;
function newProjectId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the counter-based id.
  }
  projectSeq += 1;
  return `project-${Date.now().toString(36)}-${projectSeq}`;
}

interface ProjectRowProps {
  project: CommonProject;
  error: string | null;
  tagOptions: string[];
  onNameChange: (name: string) => void;
  onFolderChange: (folder: CommonProjectFolder | null) => void;
  onTagsChange: (tags: string[]) => void;
  onChooseFolder: () => void;
  onRemove: () => void;
}

/** One sortable project row: drag handle + name, folder row, tag select. */
function ProjectRow({
  project,
  error,
  tagOptions,
  onNameChange,
  onFolderChange,
  onTagsChange,
  onChooseFolder,
  onRemove,
}: ProjectRowProps): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cls(
        "imb-project-row",
        isDragging && "imb-is-dragging",
        error !== null && "imb-has-error",
      )}
    >
      <div className="imb-project-head">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="imb-project-drag"
          aria-label={t("Reorder project")}
          title={t("Reorder project")}
          {...attributes}
          {...listeners}
        >
          <GripGlyph />
        </button>
        <Input
          className="imb-project-name-input"
          value={project.name}
          maxLength={MAX_PROJECT_NAME_LENGTH}
          placeholder={t("Project name")}
          aria-label={t("Project name")}
          invalid={error !== null}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <button
          type="button"
          className="imb-btn-icon"
          aria-label={t("Remove project")}
          title={t("Remove project")}
          onClick={onRemove}
        >
          <IconTrash className="imb-icon imb-sm" />
        </button>
      </div>
      <div className="imb-project-body">
        <div className="imb-project-folder">
          <Input
            className="imb-project-folder-path"
            value={project.folder?.path ?? ""}
            readOnly
            mono
            placeholder={t("No folder")}
            aria-label={t("Folder")}
          />
          <button
            type="button"
            className="imb-project-folder-btn"
            onClick={onChooseFolder}
          >
            {t("Select folder")}
          </button>
          {project.folder !== null && (
            <button
              type="button"
              className="imb-project-folder-btn"
              onClick={() => onFolderChange(null)}
            >
              {t("Clear")}
            </button>
          )}
        </div>
        <TagSelect
          className="imb-project-tags"
          value={project.tags}
          options={tagOptions}
          allowCreate
          placeholder={t("Tags")}
          onChange={onTagsChange}
        />
      </div>
      {error !== null && <span className="imb-project-row-error">{error}</span>}
    </div>
  );
}

/** Six-dot drag handle glyph (no dedicated icon exists). */
function GripGlyph(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="16"
      viewBox="0 0 12 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3" cy="3" r="1.4" />
      <circle cx="9" cy="3" r="1.4" />
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="9" cy="8" r="1.4" />
      <circle cx="3" cy="13" r="1.4" />
      <circle cx="9" cy="13" r="1.4" />
    </svg>
  );
}
