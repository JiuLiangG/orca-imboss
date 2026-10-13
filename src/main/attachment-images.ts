import { previewImageMime } from "@shared/image-attachments";
import { nativeImage } from "electron";
import { existsSync, readFileSync, statSync } from "fs";

/**
 * Files at or under this size are inlined verbatim. Keeps small images
 * pixel-perfect and preserves animated GIF/WebP, which a resize would flatten
 * to a single frame.
 */
const RAW_INLINE_MAX_BYTES = 1.5 * 1024 * 1024;

/** Hard upper bound we are willing to decode; anything larger is skipped. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

/** Longest edge of a resized preview, to keep the IPC payload small. */
const MAX_PREVIEW_EDGE = 1024;

/**
 * Read a previewable image attachment as a `data:` URL, or `null` when the
 * attachment is not an image, the file is missing/oversized, or reading fails.
 * Never throws: callers treat `null` as "no preview available".
 *
 * Small files are inlined byte-for-byte; larger ones are decoded and downscaled
 * (via Electron's `nativeImage`) so a full-size photo does not cross IPC at its
 * original size.
 */
export function readAttachmentImageDataUrl(
  type: string,
  name: string,
  path: string,
): string | null {
  const mime = previewImageMime(type, name);
  if (!mime) return null;
  try {
    if (!existsSync(path)) return null;
    const size = statSync(path).size;
    if (size > MAX_SOURCE_BYTES) return null;
    if (size <= RAW_INLINE_MAX_BYTES) {
      return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
    }
    return resizeToDataUrl(path);
  } catch {
    return null;
  }
}

/** Downscale an oversized image to a PNG data URL, or `null` if undecodable. */
function resizeToDataUrl(path: string): string | null {
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) return null;
  const longest = Math.max(width, height);
  const scaled =
    longest > MAX_PREVIEW_EDGE
      ? image.resize(
          width >= height
            ? { width: MAX_PREVIEW_EDGE }
            : { height: MAX_PREVIEW_EDGE },
        )
      : image;
  return scaled.toDataURL();
}
