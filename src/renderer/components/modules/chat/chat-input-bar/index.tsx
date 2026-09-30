import { MAX_USER_ATTACHMENTS } from "@shared/constants/attachments";
import { t } from "@shared/l10n";
import type { MessageAttachment } from "@shared/types";
import { useRef, useState } from "react";
import { useClickOutside } from "../../../../hooks/use-click-outside";
import { useEscapeKey } from "../../../../hooks/use-escape-key";
import { IconAttach, IconFile, IconImage, IconSend } from "../../../icons";
import { Textarea } from "../../../textarea";
import "./index.css";

export interface ChatInputBarProps {
  disabled?: boolean;
  onSend: (text: string, attachments: MessageAttachment[]) => void;
}

export function ChatInputBar({
  disabled = false,
  onSend,
}: ChatInputBarProps): React.JSX.Element {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useClickOutside(popupRef, () => setPopupOpen(false), popupOpen);
  useEscapeKey(() => setPopupOpen(false), popupOpen);

  const send = (): void => {
    const value = text.trim();
    if (disabled) return;
    if (!value && attachments.length === 0) return;
    onSend(value, attachments);
    setText("");
    setAttachments([]);
    setNotice(null);
  };

  const addFiles = (files: FileList | null): void => {
    if (!files) return;
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
    const next: MessageAttachment[] = [];
    for (const file of selected.slice(0, remaining)) {
      // `webUtils.getPathForFile` (preload) yields "" for JS-constructed files;
      // only persist a real on-disk path so the chip is revealable.
      const path = imb.files.getPath(file);
      next.push({
        name: file.name,
        size: file.size,
        type: file.type,
        ...(path ? { path } : {}),
      });
    }
    if (next.length > 0) {
      setAttachments((current) => [...current, ...next]);
    }
    setPopupOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="imb-chat-input-wrap">
      <div className="imb-chat-input-card">
        {attachments.length > 0 && (
          <div className="imb-attached-files">
            {attachments.map((file, index) => (
              <div
                className="imb-attached-file-thumb"
                key={`${file.name}-${index}`}
              >
                <div className="imb-file-icon-placeholder">
                  <IconFile />
                </div>
                <button
                  type="button"
                  className="imb-attached-file-remove"
                  aria-label={`${t("Remove")} ${file.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((_, i) => i !== index),
                    )
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
              onClick={() => setPopupOpen((v) => !v)}
            >
              <IconAttach />
            </button>
            {popupOpen && (
              <div className="imb-attach-popup imb-open" role="menu">
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
              </div>
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
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
