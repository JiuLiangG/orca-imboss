import { isSpendRange } from "@shared/constants/spend";
import type { SpendReport } from "@shared/types";
import { ipcMain } from "electron";
import { buildSpendReport } from "../spend";

export function registerSpendHandlers(): void {
  ipcMain.handle(
    "spend:report",
    (_event, range: unknown): Promise<SpendReport> =>
      buildSpendReport(isSpendRange(range) ? range : "all"),
  );
}
