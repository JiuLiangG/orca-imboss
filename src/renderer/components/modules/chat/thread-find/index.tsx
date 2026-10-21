import { t } from "@shared/l10n";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { cls } from "reactutils";
import { IconButton } from "../../../icon-button";
import {
  IconChevronDown,
  IconChevronUp,
  IconSearch,
  IconX,
} from "../../../icons";
import { Input } from "../../../input";
import type { ThreadFind } from "./use-thread-find";
import "./index.css";

export interface ThreadFindBarProps {
  /** The engine of the thread it belongs to (see `useThreadFind`). */
  find: ThreadFind;
  className?: string;
}

/**
 * Floating find bar of a conversation thread (top-right corner): a search field,
 * the `n/m` match counter, previous / next and close.
 *
 * It is a pure view over `useThreadFind` — no state of its own — and the host
 * module renders it only while `find.open`. Being an absolutely positioned
 * overlay of `.imb-chat-thread-wrap` (see `thread.css`), opening it never
 * shifts a message.
 *
 * Keyboard: Enter / Shift+Enter step through matches (⌘G / ⇧⌘G do the same
 * window-wide), Escape closes and returns the focus. The handlers live on the
 * container so they also work while one of the buttons holds the focus, and are
 * skipped while an IME composition is in flight.
 */
export function ThreadFindBar({
  find,
  className,
}: ThreadFindBarProps): React.JSX.Element {
  const {
    query,
    setQuery,
    position,
    count,
    truncated,
    noMatch,
    next,
    prev,
    closeFind,
    inputRef,
    compositionHandlers,
  } = find;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeFind();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) prev();
      else next();
    }
  };

  // Keep the slot occupied (fixed width) so the actions never jump around while
  // the counter goes from empty to `n/m` to "No matches".
  const counter =
    query.trim().length === 0
      ? ""
      : noMatch
        ? t("No matches")
        : `${position}/${count}${truncated ? "+" : ""}`;

  return (
    <div
      className={cls("imb-findbar", className)}
      role="search"
      aria-label={t("Find in chat")}
      onKeyDown={handleKeyDown}
    >
      <IconSearch className="imb-findbar-glyph" aria-hidden="true" />
      <Input
        inputRef={inputRef}
        className="imb-findbar-input"
        value={query}
        maxLength={200}
        placeholder={t("Find in chat")}
        aria-label={t("Find in chat")}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onCompositionStart={compositionHandlers.onCompositionStart}
        onCompositionEnd={compositionHandlers.onCompositionEnd}
      />
      <span
        className={cls(
          "imb-findbar-counter",
          noMatch && "imb-findbar-counter-empty",
        )}
        role="status"
        aria-live="polite"
      >
        {counter}
      </span>
      <IconButton
        className="imb-findbar-btn"
        label={t("Previous match")}
        size={14}
        boxSize={24}
        disabled={count === 0}
        onClick={prev}
      >
        <IconChevronUp />
      </IconButton>
      <IconButton
        className="imb-findbar-btn"
        label={t("Next match")}
        size={14}
        boxSize={24}
        disabled={count === 0}
        onClick={next}
      >
        <IconChevronDown />
      </IconButton>
      <IconButton
        className="imb-findbar-btn"
        label={t("Close")}
        size={14}
        boxSize={24}
        onClick={closeFind}
      >
        <IconX />
      </IconButton>
    </div>
  );
}
