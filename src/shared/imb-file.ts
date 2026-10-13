/**
 * `imb-file:` URL helpers shared by the renderer (which turns an attachment's
 * stored absolute path into a URL for `<img>`) and the main process (which
 * resolves that URL back to a path and streams the file).
 *
 * The scheme is served by a custom protocol handler (see
 * `src/main/imb-file-protocol.ts`); the page CSP allows it for `img-src` only.
 *
 * The path is carried in the query string, percent-encoded as a whole, so the
 * URL never has pathname semantics applied to it: Windows drive letters,
 * backslashes, spaces, `#`, `?`, `%` and non-ASCII bytes all round-trip
 * exactly through `encodeURIComponent` / `URLSearchParams`.
 */

/** Query key holding the percent-encoded absolute path. */
const PATH_PARAM = "p";

/** Host is a fixed placeholder; it is never interpreted. */
const URL_PREFIX = `imb-file://local/?${PATH_PARAM}=`;

/**
 * Encode an absolute on-disk path as an `imb-file:` URL. The caller is expected
 * to have validated that the path is absolute; the handler re-checks.
 *
 * `version` is an optional cache key (e.g. a file mtime). A mutable file served
 * from the same path (an employee avatar re-uploaded in the same format) would
 * otherwise reuse the browser's cached decoded image under an identical URL;
 * passing a version that changes with the bytes busts that cache. Immutable
 * files (message attachments) omit it.
 */
export function toImbFileUrl(absPath: string, version?: number | null): string {
  const base = URL_PREFIX + encodeURIComponent(absPath);
  if (version === undefined || version === null) return base;
  return `${base}&v=${encodeURIComponent(String(version))}`;
}

/**
 * Decode an `imb-file:` request URL back to its path, or `null` when the URL is
 * not an `imb-file:` URL or carries no path. Never throws.
 */
export function parseImbFilePath(rawUrl: string): string | null {
  if (!rawUrl.startsWith("imb-file:")) return null;
  try {
    const path = new URL(rawUrl).searchParams.get(PATH_PARAM);
    return path && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}
