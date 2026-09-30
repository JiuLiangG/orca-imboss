/**
 * Attachment limits, shared by the main-process validation layer, the built-in
 * team tools and the renderer UI so the numbers can never drift apart.
 */

/** Max attachments a user may attach in the chat input bar. */
export const MAX_USER_ATTACHMENTS = 16;

/** Max file paths a single agent tool call may attach. */
export const MAX_TOOL_ATTACHMENTS = 5;

/** Max attachment chips rendered in a message bubble (the rest fold into `+N`). */
export const MAX_VISIBLE_ATTACHMENTS = 5;

/**
 * Upper bound for the tool-supplied `attachmentTotal` — the true number of
 * files an agent attached when it only forwards the first
 * `MAX_TOOL_ATTACHMENTS` to the message.
 */
export const MAX_ATTACHMENT_TOTAL = 1000;
