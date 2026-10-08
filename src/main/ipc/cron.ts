import { ipcMain } from "electron";
import { removeJob } from "../cron";
import * as dbCron from "../db/cron";
import { assertInteger, assertString } from "./helpers";

export function registerCronHandlers(): void {
  // List an employee's jobs (assistant id 0 included) with chat titles resolved
  // for the Employees detail pane.
  ipcMain.handle("cron:listByEmployee", (_event, employeeId: unknown) => {
    const safeId = assertInteger(employeeId, "employee id");
    if (safeId < 0) throw new Error("employee id must not be negative.");
    return dbCron.listByEmployee(safeId);
  });

  // Remove a job: stops the live Cron handle and deletes the DB row. Returns
  // false when the job does not exist (idempotent from the renderer's view).
  ipcMain.handle("cron:remove", (_event, id: unknown): boolean => {
    const safeId = assertString(id, "cron job id");
    if (safeId.trim().length === 0) {
      throw new Error("cron job id must not be empty.");
    }
    return removeJob(safeId);
  });
}
