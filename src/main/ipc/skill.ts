import { t } from "@shared/l10n";
import type { CapabilityUnlinkResult } from "@shared/types";
import { ipcMain } from "electron";
import {
  installSkillsFromFolders,
  listSkills,
  listSkillsPage,
  uninstallSkill,
} from "../agent/skills";
import { reconcileCapabilityRefs } from "../capability-refs";
import { notifyEmployeesChanged } from "../employee-events";
import { sendToRenderer } from "../notifications";
import { showOpenDialog } from "./dialog";
import { assertString, parsePageQuery } from "./helpers";

async function pickSkillFolders(): Promise<string[] | null> {
  return showOpenDialog({
    title: t("Select skill folders"),
    properties: ["openDirectory", "multiSelections"],
  });
}

export function registerSkillHandlers(): void {
  ipcMain.handle("skills:list", () => listSkills());

  ipcMain.handle("skills:listPage", (_event, page: unknown) =>
    listSkillsPage(parsePageQuery(page)),
  );

  ipcMain.handle("skills:install", async () => {
    const paths = await pickSkillFolders();
    if (paths === null) return null;
    const imported = await installSkillsFromFolders(paths);
    // Skills live on disk and can also change outside the app; the renderer
    // caches them per module visit, so announce the change (the preload hook
    // `skills.onChanged` existed without a sender before this).
    if (imported.length > 0) sendToRenderer("skills:changed");
    return imported;
  });

  /**
   * Uninstall a skill *and* unlink it from the employees that selected it.
   *
   * The folder is the skill; `employees.skills` holds names, so removing the
   * folder without this sweep would leave a reference the renderer can never
   * show or remove again. The ids come back so the UI can report the count.
   */
  ipcMain.handle(
    "skills:uninstall",
    async (_event, name: unknown): Promise<CapabilityUnlinkResult> => {
      const safeName = assertString(name, "skill name");
      await uninstallSkill(safeName);
      const report = reconcileCapabilityRefs({
        skills: [safeName],
        force: true,
      });
      notifyEmployeesChanged(report.employeeIds);
      sendToRenderer("skills:changed");
      return { removed: true, unlinkedEmployeeIds: report.employeeIds };
    },
  );
}
