import { IMAGE_GENERATION_ENABLED } from "@shared/constants/image-gen";
import { toImbFileUrl } from "@shared/imb-file";
import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import { useState } from "react";
import { cls } from "reactutils";
import { ImageLightbox } from "../image-lightbox";
import "./index.css";

/**
 * In-chat image generation, renderer side (the call itself lives in
 * `src/main/image-gen.ts`, driven by the `imb_generate_image` tool).
 *
 * One `kind="image"` message carries the whole lifecycle in place: it is
 * appended as `generating` (the shimmer below), then the same row is updated to
 * `done` (with the picture attached) or `error`. The thread re-reads on the
 * same `messages:changed` event every append uses, so the placeholder is
 * swapped for the picture without a second channel — and the picture animates
 * in, which is the whole transition.
 *
 * The picture is rendered here rather than through the bubble's image stack:
 * a generated picture is a single, deliberate artefact, so it gets a larger
 * frame of its own (still click-to-enlarge through the shared viewer).
 *
 * The prompt stays visible under the picture: it is what a re-roll would reuse,
 * and it is the only record of what was asked for.
 */
export function ImageMessage({
  message,
  self,
}: {
  message: Message;
  self: boolean;
}): React.JSX.Element | null {
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const [zoomed, setZoomed] = useState(false);

  if (!IMAGE_GENERATION_ENABLED) return null;

  const attachment = message.attachments?.[0];
  const path = attachment?.path;
  const done =
    message.imageStatus === "done" &&
    attachment !== undefined &&
    typeof path === "string" &&
    path.length > 0;
  const failed = message.imageStatus === "error";
  const src = done ? toImbFileUrl(path) : "";

  return (
    <div
      className={cls(
        "imb-image-gen",
        self ? "imb-image-gen-self" : "imb-image-gen-other",
      )}
    >
      {done ? (
        <>
          <button
            type="button"
            className="imb-image-gen-figure"
            onClick={(event) => {
              setOrigin(event.currentTarget.getBoundingClientRect());
              setZoomed(true);
            }}
            title={t("Enlarge image")}
          >
            <img src={src} alt={message.content} />
          </button>
          {zoomed && (
            <ImageLightbox
              images={[{ name: attachment.name, src }]}
              index={0}
              origin={origin}
              onIndexChange={() => undefined}
              onClose={() => setZoomed(false)}
            />
          )}
        </>
      ) : (
        <div
          className={cls(
            "imb-image-gen-placeholder",
            failed && "imb-image-gen-failed",
          )}
          role="status"
        >
          {!failed && (
            <span className="imb-image-gen-shimmer" aria-hidden="true" />
          )}
          <span className="imb-image-gen-note">
            {failed ? t("Image generation failed") : t("Generating image…")}
          </span>
        </div>
      )}
      <p className="imb-image-gen-prompt">{message.content}</p>
    </div>
  );
}
