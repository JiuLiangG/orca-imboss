import { t } from "@shared/l10n";
import type { MessageAttachment } from "@shared/types";
import { useRef, useState } from "react";
import { useClickOutside } from "../../../../hooks/use-click-outside";
import { useEscapeKey } from "../../../../hooks/use-escape-key";
import { IconAttach, IconFile, IconImage, IconSend } from "../../../icons";
import "./index.css";

export interface ChatInputBarProps {
  disabled?: boolean;
  onSend: (text: string, attachments: MessageAttachment[]) => void;
}

/**
 * Chat composer (`.chat-input-card`): attachment chips row, autosize
 * textarea (72→160), attach popup (图片 / 文件) + circular send button.
 * Enter sends, Shift+Enter inserts a newline.
 */
export function ChatInputBar({
  disabled = false,
  onSend,
}: ChatInputBarProps): React.JSX.Element {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
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
  };

  const addFiles = (files: FileList | null): void => {
    if (!files) return;
    const next: MessageAttachment[] = [];
    for (const file of Array.from(files).slice(0, 16 - attachments.length)) {
      next.push({ name: file.name, size: file.size, type: file.type });
    }
    setAttachments((current) => [...current, ...next]);
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
        <textarea
          className="imb-chat-input-textarea"
          rows={1}
          value={text}
          placeholder={t("Describe what you want…")}
          disabled={disabled}
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
