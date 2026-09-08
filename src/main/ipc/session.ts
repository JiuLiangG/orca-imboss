import { ipcMain } from "electron";
import { deleteSession, getSession, setSession } from "../db/sessions";
import { assertInteger, assertString } from "./helpers";

export function registerSessionHandlers(): void {
  ipcMain.handle(
    "sessions:get",
    (_event, employeeId: unknown, chatId: unknown) => {
      const safeEmployee = assertInteger(employeeId, "employee id");
      const safeChat = assertInteger(chatId, "chat id");
      return getSession(safeEmployee, safeChat);
    },
  );

  ipcMain.handle(
    "sessions:set",
    (_event, employeeId: unknown, chatId: unknown, sessionPath: unknown) => {
      const safeEmployee = assertInteger(employeeId, "employee id");
      const safeChat = assertInteger(chatId, "chat id");
      setSession(
        safeEmployee,
        safeChat,
        assertString(sessionPath, "session path"),
      );
    },
  );

  ipcMain.handle(
    "sessions:delete",
    (_event, employeeId: unknown, chatId: unknown) => {
      const safeEmployee = assertInteger(employeeId, "employee id");
      const safeChat = assertInteger(chatId, "chat id");
      return deleteSession(safeEmployee, safeChat);
    },
  );
}
