import { contextBridge } from "electron";

const locale = process.argv[0] ?? "en";

contextBridge.exposeInMainWorld("imb", {
  locale,
});
