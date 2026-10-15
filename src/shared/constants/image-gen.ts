/**
 * Master switch for in-chat image generation: an agent can produce a picture
 * from a text prompt and show it in the conversation, with a placeholder that
 * is replaced in place once the picture is ready.
 *
 * The feature has three parts, all gated by this constant:
 * - the `imb_generate_image` built-in tool (see
 *   `src/main/agent/builtin-tools.ts`);
 * - the app-owned image client (`src/main/image-gen.ts`) and its setting;
 * - the message UI (`src/renderer/components/modules/chat/image-gen/`).
 *
 * Set it to `false` and the tool is never registered and the message UI falls
 * back to a plain bubble, so the app behaves exactly as it did before; revert
 * the commit to remove the feature entirely.
 */
export const IMAGE_GENERATION_ENABLED = true;
