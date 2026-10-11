import type { MessageAttachment } from "@shared/types";

/**
 * Composer-local attachment: the persisted metadata plus an optional
 * renderer-only object URL used to show an image thumbnail before sending.
 * Object URLs cannot be persisted, so the URL lives only for the session
 * (until the chip is removed, the draft is cleared, or the app exits).
 */
export interface PendingAttachment {
  id: number;
  attachment: MessageAttachment;
  previewUrl?: string;
}

/**
 * One chat's composer draft. Stored per chat in `appStore.chatDrafts` so it
 * survives a module switch (the chat module is unmounted when another nav
 * module is active).
 */
export interface ChatDraft {
  text: string;
  attachments: PendingAttachment[];
}

/**
 * Shared immutable fallback for a chat that has no draft yet. Never assigned
 * into the store (mutations always allocate a fresh draft) so it stays frozen.
 */
export const EMPTY_DRAFT: ChatDraft = { text: "", attachments: [] };

/**
 * Monotonic attachment id source. Module-scoped (not per mount) so a restored
 * draft can never collide with ids minted after a remount — including the
 * StrictMode double-mount cycle.
 */
let attachmentSeq = 0;

/** Mint a fresh id for an attachment chip. */
export function nextAttachmentId(): number {
  return attachmentSeq++;
}

/**
 * Release every renderer-only preview URL held by a draft. Called when a draft
 * is cleared (send / new chat / chat deletion); revoking an already-revoked URL
 * is a no-op, so callers need no extra bookkeeping.
 */
export function revokeDraftUrls(draft: ChatDraft | undefined): void {
  if (!draft) return;
  for (const item of draft.attachments) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}
