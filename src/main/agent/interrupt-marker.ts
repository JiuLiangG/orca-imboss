/**
 * Custom-entry type of the app's "the boss interrupted this turn here" marker.
 *
 * Stored as a Pi **custom entry** in the per-`(employee, chat)` session
 * transcript: durable, ordered exactly where the turn was cut, and by
 * construction excluded from the model's context (`CustomEntry` is
 * display/state data — `sessionEntryToContextMessages` ignores it).
 *
 * Kept in its own dependency-free module so both sides can import it without
 * dragging anything else along: `session.ts` appends it, `session-view.ts`
 * projects it into a separator for the read-only view.
 */
export const INTERRUPT_MARKER = "imboss.interrupt";
