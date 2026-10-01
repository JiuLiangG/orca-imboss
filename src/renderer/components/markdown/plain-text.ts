import remarkGfm from "remark-gfm";
import remarkMath from "remark-math-extended";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import stripMarkdown from "strip-markdown";
import { unified } from "unified";

/**
 * Markdown → plain text for the chat-list preview (and any other place that
 * needs a one-line teaser). Code, tables, math, and formatting markers are
 * removed; the result is still markdown source, so callers should collapse
 * whitespace before truncating.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(stripMarkdown, { remove: ["math", "inlineMath"] })
  .use(remarkStringify);

/** Defensive: never let a malformed document break the chat list. */
export function toPlainText(markdown: string): string {
  if (markdown.trim().length === 0) return "";
  try {
    return String(processor.processSync(markdown));
  } catch {
    return markdown;
  }
}
