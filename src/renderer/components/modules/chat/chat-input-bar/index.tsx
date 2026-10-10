import { MAX_USER_ATTACHMENTS } from "@shared/constants/attachments";
import { t } from "@shared/l10n";
import type { MessageAttachment } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { useClickOutside } from "../../../../hooks/use-click-outside";
import { useDropdownPosition } from "../../../../hooks/use-dropdown-position";
import { useEscapeKey } from "../../../../hooks/use-escape-key";
import { IconAttach, IconFile, IconImage, IconSend } from "../../../icons";
import { Textarea } from "../../../textarea";
import "./index.css";

export interface ChatInputBarProps {
  disabled?: boolean;
  /**
   * Bumped by the parent when a new chat is created. A non-zero change resets
   * the composer and focuses the textarea; `0` (the initial value) never
   * steals focus on mount.
   */
  focusToken?: number;
  onSend: (text: string, attachments: MessageAttachment[]) => void;
}

/**
 * Composer-local attachment: the persisted metadata plus an optional
 * renderer-only object URL used to show an image thumbnail before sending.
 * Object URLs cannot be persisted, so the URL lives only in this component.
 */
interface PendingAttachment {
  id: number;
  attachment: MessageAttachment;
  previewUrl?: string;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|heic|heif)$/i;

/**
 * Best-effort image detection: prefer the MIME type the picker/drag source
 * supplies, falling back to the extension because some drag sources report an
 * empty type.
 */
function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name);
}

/** True when a drag payload carries OS files (ignores text/link drags). */
function hasDroppedFiles(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
}

export function ChatInputBar({
  disabled = false,
  focusToken = 0,
  onSend,
}: ChatInputBarProps): React.JSX.Element {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextAttachmentIdRef = useRef(0);
  // Every object URL handed to an <img>; revoked on removal/send/reset/unmount
  // so the browser can release the underlying blob.
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const { panelStyle, positionPanel } = useDropdownPosition(popupRef);

  // Release every preview URL when the composer unmounts. Under StrictMode the
  // extra mount/unmount cycle runs this before any preview exists (a no-op).
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const releasePreview = useCallback((url?: string): void => {
    if (url && previewUrlsRef.current.delete(url)) {
      URL.revokeObjectURL(url);
    }
  }, []);

  // A new chat resets the composer (draft/attachments) and lands the caret in
  // the input. `focusToken` starts at `0`, so mounting with an existing chat
  // never steals focus.
  useEffect(() => {
    if (focusToken === 0) return;
    setText("");
    setAttachments((current) => {
      for (const item of current) releasePreview(item.previewUrl);
      return [];
    });
    setNotice(null);
    setPopupOpen(false);
    setDropActive(false);
    textareaRef.current?.focus();
  }, [focusToken, releasePreview]);

  // A file dropped anywhere outside the input bar would otherwise make Chromium
  // navigate the window to it. Neutralize that default globally; the input bar
  // handles its own drop (and calls preventDefault too).
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent): void => {
      if (event.dataTransfer && hasDroppedFiles(event.dataTransfer)) {
        event.preventDefault();
      }
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  // The menu is portaled to `document.body`, so it lives outside `popupRef`;
  // both count as "inside" for click-outside purposes.
  const popupOutsideRefs = useMemo(() => [popupRef, popupMenuRef], []);
  useClickOutside(popupOutsideRefs, () => setPopupOpen(false), popupOpen);
  useEscapeKey(() => setPopupOpen(false), popupOpen);

  // Reposition the portaled menu if the viewport scrolls/resizes while open.
  useEffect(() => {
    if (!popupOpen) return;
    const reposition = (): void => positionPanel();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [popupOpen, positionPanel]);

  const clearAttachments = (): void => {
    setAttachments((current) => {
      for (const item of current) releasePreview(item.previewUrl);
      return [];
    });
  };

  const send = (): void => {
    const value = text.trim();
    if (disabled) return;
    if (!value && attachments.length === 0) return;
    onSend(
      value,
      attachments.map((item) => item.attachment),
    );
    setText("");
    clearAttachments();
    setNotice(null);
  };

  const addFiles = (files: readonly File[] | null): void => {
    if (!files || files.length === 0) return;
    setNotice(null);
    const selected = Array.from(files);
    const remaining = Math.max(MAX_USER_ATTACHMENTS - attachments.length, 0);
    if (selected.length > remaining) {
      setNotice(
        t("Up to ${count} attachments allowed.", {
          count: String(MAX_USER_ATTACHMENTS),
        }),
      );
    }
    const next: PendingAttachment[] = [];
    for (const file of selected.slice(0, remaining)) {
      // `webUtils.getPathForFile` (preload) yields "" for JS-constructed files;
      // only persist a real on-disk path so the chip is revealable.
      const path = imb.files.getPath(file);
      let previewUrl: string | undefined;
      if (isImageFile(file)) {
        previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
      }
      next.push({
        id: nextAttachmentIdRef.current++,
        attachment: {
          name: file.name,
          size: file.size,
          type: file.type,
          ...(path ? { path } : {}),
        },
        ...(previewUrl ? { previewUrl } : {}),
      });
    }
    if (next.length > 0) {
      setAttachments((current) => [...current, ...next]);
    }
    setPopupOpen(false);
  };

  // Folders cannot be attached, and a `File` alone cannot be told apart from an
  // empty file; Chromium's entry API distinguishes them synchronously (no IPC).
  const addDropped = (dataTransfer: DataTransfer): void => {
    const dropped: File[] = [];
    let skippedFolder = false;
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      let isDirectory = false;
      try {
        isDirectory = item.webkitGetAsEntry()?.isDirectory === true;
      } catch {
        // Some sources throw; treat the entry as a regular file.
        isDirectory = false;
      }
      if (isDirectory) {
        skippedFolder = true;
        continue;
      }
      dropped.push(file);
    }
    // Sources without `items` (or with only string items) fall back to `files`.
    if (dropped.length === 0 && !skippedFolder) {
      dropped.push(...Array.from(dataTransfer.files));
    }
    const remaining = Math.max(MAX_USER_ATTACHMENTS - attachments.length, 0);
    addFiles(dropped);
    // Only surface the folder notice when the cap notice did not take over.
    if (skippedFolder && dropped.length <= remaining) {
      setNotice(t("Folders cannot be attached."));
    }
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dropActive) setDropActive(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    // Moving over a child fires dragleave on the parent; ignore those.
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    setDropActive(false);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDropActive(false);
    addDropped(event.dataTransfer);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div
      className={cls("imb-chat-input-wrap", dropActive && "imb-drop-active")}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropActive && (
        <div className="imb-drop-hint">{t("Drop files to attach")}</div>
      )}
      <div className="imb-chat-input-card">
        {attachments.length > 0 && (
          <div className="imb-attached-files">
            {attachments.map((item, index) => (
              <div className="imb-attached-file-thumb" key={item.id}>
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={item.attachment.name} />
                ) : (
                  <div className="imb-file-icon-placeholder">
                    <IconFile />
                  </div>
                )}
                <button
                  type="button"
                  className="imb-attached-file-remove"
                  aria-label={`${t("Remove")} ${item.attachment.name}`}
                  onClick={() =>
                    setAttachments((current) => {
                      releasePreview(current[index]?.previewUrl);
                      return current.filter((_, i) => i !== index);
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {notice !== null && <div className="imb-attach-notice">{notice}</div>}
        <Textarea
          ref={textareaRef}
          className="imb-chat-input-textarea"
          rows={1}
          value={text}
          placeholder={t("What are your instructions?")}
          disabled={disabled}
          minHeight={0}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="imb-chat-input-actions">
          <div className="imb-attach-anchor" ref={popupRef}>
            <button
              type="button"
              className="imb-attach-btn"
              aria-label={t("Attach")}
              title={t("Attach")}
              onClick={() => {
                if (popupOpen) {
                  setPopupOpen(false);
                  return;
                }
                positionPanel();
                setPopupOpen(true);
              }}
            >
              <IconAttach />
            </button>
            {popupOpen &&
              panelStyle &&
              createPortal(
                <div
                  ref={popupMenuRef}
                  className="imb-attach-popup imb-open"
                  role="menu"
                  style={{
                    position: "fixed",
                    top: panelStyle.top,
                    bottom: panelStyle.bottom,
                    left: panelStyle.left,
                    width: panelStyle.width,
                    maxHeight: panelStyle.maxHeight,
                    right: "auto",
                    zIndex: 50,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="imb-attach-popup-item"
                    onClick={() => {
                      setPopupOpen(false);
                      imageInputRef.current?.click();
                    }}
                  >
                    <IconImage />
                    <span>{t("Image")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="imb-attach-popup-item"
                    onClick={() => {
                      setPopupOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <IconFile />
                    <span>{t("File")}</span>
                  </button>
                </div>,
                document.body,
              )}
          </div>
          <button
            type="button"
            className="imb-send-btn-circle"
            aria-label={t("Send")}
            disabled={disabled || (!text.trim() && attachments.length === 0)}
            onClick={send}
          >
            <IconSend />
          </button>
        </div>
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files ? Array.from(e.target.files) : null);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files ? Array.from(e.target.files) : null);
          e.target.value = "";
        }}
      />
    </div>
  );
}
