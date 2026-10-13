import { isPreviewableImagePath } from "@shared/image-attachments";
import { parseImbFilePath } from "@shared/imb-file";
import { net, protocol } from "electron";
import { statSync } from "fs";
import { isAbsolute } from "path";
import { pathToFileURL } from "url";

/** Scheme served by {@link registerImbFileHandler}. */
const SCHEME = "imb-file";

/**
 * Register the `imb-file:` scheme as standard + secure + streamable.
 *
 * Must run before the `app` `ready` event (Electron requirement) — this project
 * calls it from the top level of `src/main/index.ts`.
 *
 * Deliberately NOT granted: `bypassCSP` (the page CSP still governs the scheme;
 * `imb-file:` is added to `img-src` explicitly), `supportFetchAPI` (only `<img>`
 * may use it, no `fetch()` from the renderer) and `corsEnabled` (keeps a
 * cross-origin canvas from reading the served image's pixels).
 */
export function registerImbFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, stream: true },
    },
  ]);
}

/**
 * Serve an `imb-file:` URL from disk.
 *
 * Trust model: the URL carries an arbitrary absolute path — there is no path
 * whitelist. The exposure is bounded by (a) `imb-file:` being allowed in
 * `img-src` only, (b) the guard below refusing anything that is not a regular
 * file with a previewable-image extension, so non-image files (e.g. an SSH key)
 * are never read into the renderer, and (c) the scheme privileges defined in
 * {@link registerImbFileScheme}.
 */
export function registerImbFileHandler(): void {
  protocol.handle(SCHEME, (request) => {
    const path = parseImbFilePath(request.url);
    if (!path || !isAbsolute(path)) {
      return new Response(null, { status: 400 });
    }
    // Reject disallowed extensions before touching the filesystem, so a
    // non-image path is never even stat'ed.
    if (!isPreviewableImagePath(path)) {
      return new Response(null, { status: 403 });
    }
    try {
      if (!statSync(path).isFile()) return new Response(null, { status: 404 });
    } catch {
      return new Response(null, { status: 404 });
    }
    return net.fetch(pathToFileURL(path).toString());
  });
}
