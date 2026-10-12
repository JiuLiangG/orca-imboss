/**
 * `@ID` mention rendering for chat content.
 *
 * The app convention is that agents write `@<employeeId>` as plain text (and
 * wake the target through the `notify` tool argument — see
 * `src/shared/constants/prompts.ts`). The model must keep reading that raw
 * form, but the UI should show a human name. This module is the renderer-side
 * half: a small, dependency-free rehype plugin that turns `@<id>` text into a
 * custom `<imb-mention employeeId=N>@<name></imb-mention>` element the
 * Markdown component maps to a themed React node.
 *
 * The transform is deliberately conservative: it only rewrites `text` nodes
 * (never code, inline code, links, or math) and leaves ids that do not resolve
 * to a known employee as literal `@<id>` text.
 */

/** Matches `@<employee id>` with ASCII word boundaries (`foo@123` / `@123abc` do not match). */
export const MENTION_PATTERN = /(?<![0-9A-Za-z_@])@([0-9]+)(?![0-9A-Za-z_])/g;

/** Custom hast tag emitted for a resolved mention; mapped to a component in `Markdown`. */
export const MENTION_TAG = "imb-mention";

/** Elements whose subtrees are never rewritten. Math is emitted as `code`/`math`-classed elements. */
const SKIP_TAGS = new Set(["code", "pre", "a"]);

export interface MentionPluginOptions {
  /** Resolve an employee id to a display name; `null` keeps the raw `@<id>` text. */
  resolve: (id: number) => string | null;
}

/**
 * Minimal hast shapes. `hast` is not a direct dependency (it is only
 * transitive), so these local types avoid a type-only import that pnpm would
 * not resolve.
 */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

function isText(node: HastNode): node is HastNode & { value: string } {
  return node.type === "text" && typeof node.value === "string";
}

function isElement(node: HastNode): node is HastNode & {
  tagName: string;
  children: HastNode[];
  properties: Record<string, unknown>;
} {
  return (
    node.type === "element" &&
    typeof node.tagName === "string" &&
    Array.isArray(node.children)
  );
}

/** True for elements the parser gave a `math`/`katex` class (pre-`rehype-katex` math nodes). */
function hasMathClass(
  properties: Record<string, unknown> | undefined,
): boolean {
  const className = properties?.className;
  const values = Array.isArray(className)
    ? className
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];
  return values.some(
    (value) =>
      typeof value === "string" &&
      (value === "math" || value.startsWith("math-") || value === "katex"),
  );
}

function mentionElement(id: number, name: string): HastNode {
  return {
    type: "element",
    tagName: MENTION_TAG,
    properties: { employeeId: id },
    children: [{ type: "text", value: `@${name}` }],
  };
}

/** Split one text value into text + mention nodes; unresolved ids stay in the text. */
function splitText(
  value: string,
  resolve: (id: number) => string | null,
): HastNode[] {
  let last = 0;
  const parts: HastNode[] = [];
  for (const match of value.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    const id = Number(match[1]);
    const name = Number.isSafeInteger(id) ? resolve(id) : null;
    if (name === null || name.length === 0) continue;
    if (index > last) {
      parts.push({ type: "text", value: value.slice(last, index) });
    }
    parts.push(mentionElement(id, name));
    last = index + match[0].length;
  }
  if (parts.length === 0) return [{ type: "text", value }];
  if (last < value.length) {
    parts.push({ type: "text", value: value.slice(last) });
  }
  return parts;
}

/** Walk a tree in place, rewriting mention text below nodes that are safe to touch. */
function transform(
  node: HastNode,
  resolve: (id: number) => string | null,
): void {
  const children = node.children;
  if (!Array.isArray(children)) return;
  const next: HastNode[] = [];
  for (const child of children) {
    if (isText(child)) {
      next.push(...splitText(child.value, resolve));
      continue;
    }
    if (
      isElement(child) &&
      !SKIP_TAGS.has(child.tagName) &&
      !hasMathClass(child.properties)
    ) {
      transform(child, resolve);
    }
    next.push(child);
  }
  node.children = next;
}

/** Rehype transformer factory. `resolve` must return a non-empty name or `null`. */
export function mentionPlugin(
  options: MentionPluginOptions,
): (tree: HastNode) => void {
  const { resolve } = options;
  return (tree) => {
    transform(tree, resolve);
  };
}

/**
 * Plain-text variant for the chat-list preview (no theming possible there):
 * replace every resolved `@<id>` with `@<name>`, leaving the rest untouched.
 */
export function replaceMentions(
  text: string,
  resolve: (id: number) => string | null,
): string {
  return text.replace(MENTION_PATTERN, (match, idText: string) => {
    const id = Number(idText);
    const name = Number.isSafeInteger(id) ? resolve(id) : null;
    return name !== null && name.length > 0 ? `@${name}` : match;
  });
}
