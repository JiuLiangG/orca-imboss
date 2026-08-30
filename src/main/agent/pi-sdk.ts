/**
 * Lazy loader for the Pi SDK.
 *
 * `@earendil-works/pi-coding-agent` is an **ESM-only** package (its `exports`
 * map has no `require`/`default` condition), while this app's main process is
 * built/bundled as CommonJS. Node >= 22 can `import()` ESM from CJS, so the
 * SDK is always loaded through dynamic import here. To keep it that way after
 * bundling, the vite main config sets `output.dynamicImportInCjs = false`
 * (see `electron.vite.config.ts`).
 *
 * The module is only touched on demand (agent runs), so app startup stays
 * synchronous and unaffected by the SDK's heavy dependency tree.
 */

export type PiSdk = typeof import("@earendil-works/pi-coding-agent");

let sdkPromise: Promise<PiSdk> | null = null;

/** Load (once) and cache the Pi SDK module. */
export function loadPiSdk(): Promise<PiSdk> {
  sdkPromise ??= import("@earendil-works/pi-coding-agent") as Promise<PiSdk>;
  return sdkPromise;
}
