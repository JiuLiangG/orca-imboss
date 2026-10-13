import { MAX_ATTACHMENT_BYTES } from "@shared/constants/attachments";
import { t } from "@shared/l10n";
import { ipcMain } from "electron";
import { basename, isAbsolute } from "path";
import { deletePastedFile, savePastedFile } from "../attachments";
import { showOpenDialog } from "./dialog";
import { assertInteger, assertString } from "./helpers";

export function registerFileHandlers(): void {
  // Persist bytes pasted into the composer that have no backing file on disk
  // (screenshots / copied image data). The renderer must send a generated,
  // non-authoritative `name`/`type`; main sanitizes both and owns the path.
  ipcMain.handle(
    "files:savePastedFile",
    (_event, chatId: unknown, name: unknown, type: unknown, data: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeName = assertString(name, "file name");
      const safeType = assertString(type, "file type");
      return savePastedFile(safeChatId, safeName, safeType, toBuffer(data));
    },
  );

  // Remove the on-disk copy of a pasted attachment when its chip is discarded.
  // Main verifies the path belongs to the pasted store before deleting, so a
  // disk-backed user file (original path) is never removed.
  ipcMain.handle("files:deletePastedFile", (_event, path: unknown) => {
    deletePastedFile(assertString(path, "attachment path"));
  });

  // Choose one or more folders from the native directory dialog. The path
  // always originates in main (never a renderer-supplied string), matching the
  // workdir picker and the reveal IPC's trust model. A folder is attached by
  // path only — no bytes are copied; the model reads the directory in place.
  ipcMain.handle("files:chooseDirectories", async () => {
    const paths = await showOpenDialog({
      title: t("Select folder"),
      properties: ["openDirectory", "multiSelections"],
    });
    if (!paths) return null;
    return paths
      .filter((path) => isAbsolute(path))
      .map((path) => ({ name: basename(path), path }));
  });
}

/** Coerce renderer bytes to a `Buffer`, rejecting oversized payloads early. */
function toBuffer(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) {
    if (value.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment is too large.");
    }
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    if (value.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment is too large.");
    }
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("file data must be a Uint8Array or ArrayBuffer.");
}
