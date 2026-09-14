import type { Employee, EmployeeInput } from "@shared/types";
import { ipcMain } from "electron";
import { deleteAvatarFiles, saveAvatar } from "../avatars";
import * as dbEmployees from "../db/employees";
import { listByEmployee, unlinkSessionFile } from "../db/sessions";
import { assertInteger, assertString, parsePageQuery } from "./helpers";

export function registerEmployeeHandlers(): void {
  ipcMain.handle("employees:list", () => dbEmployees.listEmployees());

  ipcMain.handle("employees:listPage", (_event, page: unknown) =>
    dbEmployees.listEmployeesPage(parsePageQuery(page)),
  );

  ipcMain.handle("employees:create", (_event, input: EmployeeInput): Employee =>
    dbEmployees.createEmployee(input),
  );

  ipcMain.handle(
    "employees:update",
    (_event, id: unknown, input: EmployeeInput) => {
      const safeId = assertInteger(id, "employee id");
      return dbEmployees.updateEmployee(safeId, input);
    },
  );

  ipcMain.handle("employees:delete", async (_event, id: unknown) => {
    const safeId = assertInteger(id, "employee id");
    // Capture disk session file paths BEFORE the FK cascade wipes the rows.
    const records = listByEmployee(safeId);
    const result = dbEmployees.deleteEmployee(safeId);
    // Only a hard delete removes disk artifacts; a soft delete (employee still
    // a chat participant) keeps the session/avatar state intact.
    if (result === "deleted") {
      await Promise.all(records.map((r) => unlinkSessionFile(r.session)));
      deleteAvatarFiles(safeId);
    }
    return result;
  });

  ipcMain.handle(
    "employees:updateAvatar",
    (_event, id: unknown, ext: unknown, data: unknown) => {
      const safeId = assertInteger(id, "employee id");
      const safeExt = assertString(ext, "ext");
      if (!(data instanceof Uint8Array)) {
        throw new Error("Avatar data must be bytes.");
      }
      const path = saveAvatar(safeId, safeExt, Buffer.from(data));
      return dbEmployees.updateEmployeeAvatar(safeId, path);
    },
  );
}
