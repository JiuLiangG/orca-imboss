import { t } from "@shared/l10n";
import { ipcMain } from "electron";
import {
  installSkillsFromFolders,
  listSkills,
  listSkillsPage,
  uninstallSkill,
} from "../agent/skills";
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
    return imported;
  });

  ipcMain.handle("skills:uninstall", async (_event, name: unknown) => {
    await uninstallSkill(assertString(name, "skill name"));
  });
}
