/**
 * Mini Apps — a folder under `~/.imboss/mini-apps/<id>/` with a `metadata.json`
 * describing a web app the main app embeds in an `<iframe>`. See
 * `src/main/mini-apps.ts` for the scanner/supervisor.
 */

/** One registered mini app, as sent to the renderer. */
export interface MiniApp {
  /** Folder name under `~/.imboss/mini-apps` (stable, used for ordering). */
  id: string;
  /** Display label from `metadata.json` (validated, non-empty). */
  name: string;
  /** Entry URL (loopback http/https only). */
  entry: string;
  /** Icon as a data URL, or `null` when absent/unreadable/oversized. */
  iconUrl: string | null;
  /** `true` when the metadata defines a supervised `command`. */
  hasServer: boolean;
}
