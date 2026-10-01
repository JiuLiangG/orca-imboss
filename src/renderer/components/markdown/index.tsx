import { memo, useMemo } from "react";
import ReactMarkdown, {
  type Components,
  type UrlTransform,
} from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math-extended";
import { cls } from "reactutils";
import type { PluggableList } from "unified";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import "./index.css";

/**
 * Markdown + KaTeX renderer for chat content.
 *
 * Security posture:
 * - Raw HTML is not rendered: react-markdown has no `rehype-raw`, so `raw` hast
 *   nodes become plain text.
 * - `urlTransform` that runs after the rehype plugins restricts link/image URLs
 *   to a small protocol allowlist (see `sanitizeUrl`), so a malicious href such
 *   as `javascript:` never reaches the DOM.
 * - KaTeX keeps its default `trust: false`, so `\href`/`\html*` commands cannot
 *   inject markup.
 * - Highlighted code is produced by `highlight.js`, whose output is
 *   HTML-escaped before it is handed to `dangerouslySetInnerHTML`.
 */

/** Module-level plugin lists keep referential stability across re-renders. */
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: PluggableList = [[rehypeKatex, { strict: "ignore" }]];

const SAFE_HREF_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Restrict processed URLs. react-markdown applies this to every URL attribute
 * (`href`, `src`, …); `key` tells us which one. Anything not explicitly allowed
 * is dropped to an empty string (rendered inert by the custom components).
 */
const sanitizeUrl: UrlTransform = (url, key) => {
  const value = typeof url === "string" ? url.trim() : "";
  if (value.length === 0) return "";
  // Strip control characters and whitespace that could disguise a scheme
  // (e.g. `java\tscript:`), then inspect the leading scheme.
  const normalized = value.replace(/[\u0000-\u0020\u007f]+/g, "");
  const colon = normalized.indexOf(":");
  if (colon < 1) return "";
  const scheme = `${normalized.slice(0, colon).toLowerCase()}:`;
  if (key === "src") {
    if (scheme === "https:") return value;
    // Inline images only; never `data:text/html` or similar.
    return normalized.toLowerCase().startsWith("data:image/") ? value : "";
  }
  return SAFE_HREF_SCHEMES.has(scheme) ? value : "";
};

/** Highlight one fenced code block; falls back to escaped plain text. */
function highlightCode(code: string, language: string | undefined): string {
  try {
    if (language !== undefined && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build the element overrides. `inline` adds a paragraph unwrapper so the
 * output stays phrasing content and can be embedded in labels/table cells.
 */
function createComponents(inline: boolean): Components {
  const components: Components = {
    a({ href, title, children }) {
      if (typeof href !== "string" || href.length === 0) {
        return <span className="imb-md-link-inert">{children}</span>;
      }
      return (
        <a href={href} title={title} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
    img({ src, alt, title }) {
      if (typeof src !== "string" || src.length === 0) return null;
      return (
        <img
          src={src}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      );
    },
    code({ className, children }) {
      const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
      if (language === undefined) {
        // Inline code, or a fenced block without an info string; the `pre`
        // wrapper (when present) is styled by CSS.
        return <code className={className}>{children}</code>;
      }
      const source = String(children).replace(/\n$/, "");
      return (
        <code
          className={cls(className, "hljs")}
          dangerouslySetInnerHTML={{ __html: highlightCode(source, language) }}
        />
      );
    },
  };
  if (inline) {
    components.p = ({ children }) => <>{children}</>;
  }
  return components;
}

export interface MarkdownProps {
  content: string;
  /** Render as phrasing content (no block wrapper); for labels and table cells. */
  inline?: boolean;
  className?: string;
}

/**
 * Memoized so a thread re-render (e.g. a new message) does not re-parse every
 * already-rendered message.
 */
export const Markdown = memo(function Markdown({
  content,
  inline = false,
  className,
}: MarkdownProps): React.JSX.Element {
  const components = useMemo(() => createComponents(inline), [inline]);
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper
      className={cls(
        "imb-markdown",
        inline && "imb-markdown-inline",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={sanitizeUrl}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </Wrapper>
  );
});
