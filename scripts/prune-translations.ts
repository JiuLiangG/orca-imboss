#!/usr/bin/env node
/**
 * Detect and remove unused keys from the Simplified Chinese dictionary
 * (`src/shared/translations/zhCN.json`).
 *
 * Detection is intentionally conservative: a key is only considered unused
 * when its exact text does not appear as *any* string literal under `src/`.
 * This protects keys that are referenced indirectly (e.g. `t(item.labelKey)`
 * or `t(color.id)`) from being deleted, and also surfaces keys that are
 * referenced outside `t()` (native dialog titles, raw component labels).
 *
 * Usage:
 *   node scripts/prune-translations.ts            # list + confirm, then remove
 *   node scripts/prune-translations.ts --dry-run  # list only, never writes
 *   node scripts/prune-translations.ts --yes      # skip the confirmation
 *
 * Only Node.js built-ins are used; no build step is required.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "src");
const DICT_PATH = join(SRC_DIR, "shared", "translations", "zhCN.json");

/** A decoded string literal and the index of its opening quote. */
interface StringToken {
  value: string;
  start: number;
}

/** A source location for a string literal occurrence. */
interface Location {
  file: string;
  line: number;
}

interface Usage {
  /** Every string literal value found under `src/` (conservative protection). */
  allLiterals: Set<string>;
  /** Values passed as the first argument to `t("...")`. */
  tKeys: Set<string>;
  /** Values reached through known indirection (labelKey/descKey/titleKey, theme ids). */
  indirectKeys: Set<string>;
  /** Occurrences of dictionary keys, for the raw-only report. */
  literalLocations: Map<string, Location[]>;
}

function decodeEscape(ch: string | undefined): string {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "v":
      return "\v";
    case "0":
      return "\0";
    case undefined:
      return "";
    default:
      return ch;
  }
}

function parseHex(
  source: string,
  from: number,
  length: number,
): number | undefined {
  const digits = source.slice(from, from + length);
  if (digits.length !== length || !/^[0-9A-Fa-f]+$/.test(digits)) {
    return undefined;
  }
  return Number.parseInt(digits, 16);
}

/**
 * Decode the escape sequence at `index` (the character right after a
 * backslash), returning the decoded value and the index just past it.
 *
 * Handles `\xHH`, `\uHHHH`, `\u{...}` and line continuations in addition to
 * the single-character escapes, so source literals compare equal to their
 * JSON-decoded counterpart (e.g. `"Now\u200B"` → `Now` + U+200B).
 */
function readEscape(
  source: string,
  index: number,
): { value: string; end: number } {
  const ch = source[index];
  switch (ch) {
    case "x": {
      const code = parseHex(source, index + 1, 2);
      if (code !== undefined) {
        return { value: String.fromCharCode(code), end: index + 3 };
      }
      break;
    }
    case "u": {
      if (source[index + 1] === "{") {
        const close = source.indexOf("}", index + 2);
        if (close !== -1) {
          const code = parseHex(source, index + 2, close - (index + 2));
          if (code !== undefined && code <= 0x10ffff) {
            return { value: String.fromCodePoint(code), end: close + 1 };
          }
        }
      } else {
        const code = parseHex(source, index + 1, 4);
        if (code !== undefined) {
          return { value: String.fromCharCode(code), end: index + 5 };
        }
      }
      break;
    }
    // Line continuations: `\<newline>` collapses to nothing.
    case "\r":
      return source[index + 1] === "\n"
        ? { value: "", end: index + 2 }
        : { value: "", end: index + 1 };
    case "\n":
    case "\u2028":
    case "\u2029":
      return { value: "", end: index + 1 };
    case undefined:
      return { value: "", end: index + 1 };
  }
  return { value: decodeEscape(ch), end: index + 1 };
}

/** An inclusive-exclusive range of offsets in a source file. */
interface Range {
  start: number;
  end: number;
}

/** A scan result: string/template literals, comments, and template text. */
interface ScanResult {
  /** Decoded string and template literals, keyed by their opening quote. */
  tokens: StringToken[];
  /** Comment ranges (`//` and `/* ... *`/). */
  comments: Range[];
  /**
   * Raw text ranges inside template literals — the literal text between the
   * backtick and `${ ... }` delimiters, which contains no code.
   */
  templateText: Range[];
}

/** What the scanner last consumed, used to tell regex literals from division. */
type PrevToken =
  | { kind: "none" }
  | { kind: "value" }
  | { kind: "word"; text: string }
  | { kind: "punct"; char: string };

/** Keywords after which a `/` always starts a regex literal. */
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const isWordChar = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);

function regexAllowed(prev: PrevToken): boolean {
  switch (prev.kind) {
    case "none":
      return true;
    case "value":
      return false;
    case "word":
      return REGEX_KEYWORDS.has(prev.text);
    case "punct":
      // After `)` / `]` / `.` a `/` is division, not a regex (heuristic; a
      // regex directly after `if (...)` is rare enough to accept).
      return prev.char !== ")" && prev.char !== "]" && prev.char !== ".";
  }
}

/** Blanks out the given ranges, preserving length and newlines. */
function blankRanges(source: string, ranges: Range[]): string {
  const chars = source.split("");
  for (const range of ranges) {
    for (let i = range.start; i < range.end; i++) {
      if (source[i] !== "\n") chars[i] = " ";
    }
  }
  return chars.join("");
}

/**
 * Scan `source` in a single pass, tracking string/template nesting:
 *
 * - Plain strings and template literals are emitted as tokens (escapes
 *   decoded). Template tokens hold their verbatim text, including any
 *   `${ ... }` expression text.
 * - Template interpolations are scanned as code, so literals nested inside
 *   them (e.g. `` `...${t("key")}...` ``) become tokens of their own instead
 *   of being swallowed by the surrounding template.
 * - Regex literals are recognized (via a prev-token heuristic) so quotes
 *   inside them (e.g. `/^["']|["']$/`) cannot desynchronize the scan.
 * - Comments are collected as ranges and skipped.
 */
function scanSource(source: string): ScanResult {
  const tokens: StringToken[] = [];
  const comments: Range[] = [];
  const templateText: Range[] = [];
  const n = source.length;

  // Open template literals (value accumulates verbatim text) and `${ ... }`
  // expression regions (with brace depth), interleaved as a stack.
  type Frame =
    | { kind: "template"; start: number; value: string; textStart: number }
    | { kind: "expr"; depth: number };
  const stack: Frame[] = [];

  const templateBelow = (): (Frame & { kind: "template" }) | undefined => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const frame = stack[k];
      if (frame.kind === "template") return frame;
    }
    return undefined;
  };

  /** Append raw text to the nearest enclosing template's verbatim value. */
  const appendRaw = (from: number, to: number): void => {
    const template = templateBelow();
    if (template !== undefined) template.value += source.slice(from, to);
  };

  const scanPlainString = (start: number): number => {
    const quote = source[start];
    let j = start + 1;
    let value = "";
    while (j < n) {
      const d = source[j];
      if (d === "\\") {
        const escape = readEscape(source, j + 1);
        value += escape.value;
        j = escape.end;
        continue;
      }
      if (d === quote) break;
      value += d;
      j++;
    }
    tokens.push({ value, start });
    return j + 1;
  };

  /** Scan a regex literal; returns -1 if unterminated (not a regex). */
  const scanRegex = (start: number): number => {
    let j = start + 1;
    let inClass = false;
    while (j < n) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "\n") return -1;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j++;
        while (j < n && /[dgimsuvy]/.test(source[j])) j++;
        return j;
      }
      j++;
    }
    return -1;
  };

  let prev: PrevToken = { kind: "none" };
  let i = 0;
  while (i < n) {
    const c = source[i];
    const top = stack[stack.length - 1];
    const inCode = top === undefined || top.kind === "expr";

    if (inCode) {
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        i++;
        continue;
      }
      if (c === "/" && source[i + 1] === "/") {
        const end = source.indexOf("\n", i);
        const endOrN = end === -1 ? n : end;
        comments.push({ start: i, end: endOrN });
        i = endOrN;
        continue;
      }
      if (c === "/" && source[i + 1] === "*") {
        let end = i + 2;
        while (end < n && !(source[end] === "*" && source[end + 1] === "/")) {
          end++;
        }
        end = Math.min(end + 2, n);
        comments.push({ start: i, end });
        i = end;
        continue;
      }
      if (c === '"' || c === "'") {
        const end = scanPlainString(i);
        appendRaw(i, end);
        prev = { kind: "value" };
        i = end;
        continue;
      }
      if (c === "/" && regexAllowed(prev)) {
        const end = scanRegex(i);
        if (end !== -1) {
          appendRaw(i, end);
          prev = { kind: "value" };
          i = end;
          continue;
        }
      }
      if (c === "`") {
        stack.push({ kind: "template", start: i, value: "", textStart: i + 1 });
        prev = { kind: "none" };
        i++;
        continue;
      }
      if (c === "{") {
        if (top !== undefined && top.kind === "expr") top.depth++;
        appendRaw(i, i + 1);
        prev = { kind: "punct", char: c };
        i++;
        continue;
      }
      if (c === "}") {
        if (top !== undefined && top.kind === "expr") {
          top.depth--;
          if (top.depth === 0) {
            stack.pop();
            const template = templateBelow();
            if (template !== undefined) {
              template.value += "}";
              template.textStart = i + 1;
            }
            prev = { kind: "none" };
            i++;
            continue;
          }
        }
        appendRaw(i, i + 1);
        prev = { kind: "punct", char: c };
        i++;
        continue;
      }
      if (c === "$" && source[i + 1] === "{" && top?.kind === "template") {
        templateText.push({ start: top.textStart, end: i });
        top.value += "${";
        stack.push({ kind: "expr", depth: 1 });
        prev = { kind: "punct", char: "(" };
        i += 2;
        continue;
      }
      if (isWordChar(c)) {
        let j = i;
        while (j < n && isWordChar(source[j])) j++;
        appendRaw(i, j);
        prev = { kind: "word", text: source.slice(i, j) };
        i = j;
        continue;
      }
      if ((c === "+" || c === "-") && source[i + 1] === c) {
        // `++` / `--` complete an expression, so a following `/` is division.
        appendRaw(i, i + 2);
        prev = { kind: "value" };
        i += 2;
        continue;
      }
      appendRaw(i, i + 1);
      prev = { kind: "punct", char: c };
      i++;
      continue;
    }

    // Template literal text.
    if (c === "\\") {
      const escape = readEscape(source, i + 1);
      top.value += escape.value;
      i = escape.end;
      continue;
    }
    if (c === "`") {
      templateText.push({ start: top.textStart, end: i });
      tokens.push({ value: top.value, start: top.start });
      appendRaw(top.start, i + 1);
      stack.pop();
      prev = { kind: "value" };
      i++;
      continue;
    }
    if (c === "$" && source[i + 1] === "{") {
      templateText.push({ start: top.textStart, end: i });
      top.value += "${";
      stack.push({ kind: "expr", depth: 1 });
      prev = { kind: "punct", char: "(" };
      i += 2;
      continue;
    }
    top.value += c;
    i++;
  }

  // Flush unterminated template literals so their text still counts.
  for (const frame of stack) {
    if (frame.kind === "template")
      tokens.push({ value: frame.value, start: frame.start });
  }

  return { tokens, comments, templateText };
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(p);
      }
    }
  };
  walk(dir);
  files.sort();
  return files;
}

/** Offsets at which each line starts, for O(log n) offset → line lookup. */
function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found + 1;
}

function extractUsage(files: string[], dictKeys: Set<string>): Usage {
  const allLiterals = new Set<string>();
  const tKeys = new Set<string>();
  const indirectKeys = new Set<string>();
  const literalLocations = new Map<string, Location[]>();

  // `t("...")` — reject member calls like `obj.t(...)` and longer identifiers.
  const tCall = /(^|[^\w$.])t\s*\(\s*/g;
  // Config values that are later fed to `t()`.
  const keyProp = /(^|[^\w$.])(labelKey|descKey|titleKey)\s*:\s*/g;
  // Accent ids inside the `THEME_COLORS` declaration (used via `t(color.id)`).
  const themeDecl = /(?:export\s+)?const\s+THEME_COLORS\s*[:=]/;
  const idProp = /(^|[^\w$.])id\s*:\s*/g;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const { tokens, comments, templateText } = scanSource(source);
    // Comments and template literal text are blanked (length-preserving) so
    // the context regexes below cannot match inside them.
    const stripped = blankRanges(source, [...comments, ...templateText]);
    const byStart = new Map<number, string>();
    const lineStarts = buildLineStarts(source);
    const relFile = relative(ROOT, file);
    for (const token of tokens) {
      allLiterals.add(token.value);
      byStart.set(token.start, token.value);
      if (dictKeys.has(token.value)) {
        const locations = literalLocations.get(token.value) ?? [];
        locations.push({
          file: relFile,
          line: lineAt(lineStarts, token.start),
        });
        literalLocations.set(token.value, locations);
      }
    }

    let match: RegExpExecArray | null;

    tCall.lastIndex = 0;
    while ((match = tCall.exec(stripped)) !== null) {
      const value = byStart.get(match.index + match[0].length);
      if (value !== undefined) tKeys.add(value);
    }

    keyProp.lastIndex = 0;
    while ((match = keyProp.exec(stripped)) !== null) {
      const value = byStart.get(match.index + match[0].length);
      if (value !== undefined) indirectKeys.add(value);
    }

    if (themeDecl.test(stripped)) {
      idProp.lastIndex = 0;
      while ((match = idProp.exec(stripped)) !== null) {
        const value = byStart.get(match.index + match[0].length);
        if (value !== undefined) indirectKeys.add(value);
      }
    }
  }

  return { allLiterals, tKeys, indirectKeys, literalLocations };
}

function printSection(title: string, items: string[]): void {
  console.log(`\n${title} (${items.length}):`);
  if (items.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const item of items) console.log(`  - ${item}`);
}

function printRawOnly(
  keys: string[],
  locations: Map<string, Location[]>,
): void {
  console.log(`\nReferenced outside t() — never translated (${keys.length}):`);
  if (keys.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const key of keys) {
    console.log(`  - ${key}`);
    const seen = new Set<string>();
    for (const location of locations.get(key) ?? []) {
      const label = `${location.file}:${location.line}`;
      if (seen.has(label)) continue;
      seen.add(label);
      console.log(`      ${label}`);
    }
  }
}

function printUsage(): void {
  console.log(
    [
      "Detect and remove unused translation keys from zhCN.json.",
      "",
      "Usage: node scripts/prune-translations.ts [options]",
      "",
      "Options:",
      "  --dry-run   List unused keys and exit without writing.",
      "  --yes       Skip the interactive confirmation (for automation).",
      "  -h, --help  Show this help.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help === true) {
    printUsage();
    return;
  }

  const dryRun = values["dry-run"] === true;
  const assumeYes = values.yes === true;

  if (!existsSync(DICT_PATH)) {
    throw new Error(`Translation dictionary not found: ${DICT_PATH}`);
  }

  let dict: Record<string, unknown>;
  try {
    dict = JSON.parse(readFileSync(DICT_PATH, "utf8")) as Record<
      string,
      unknown
    >;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${relative(ROOT, DICT_PATH)}: ${message}`);
  }

  const keys = Object.keys(dict);
  const files = collectSourceFiles(SRC_DIR);
  const { allLiterals, tKeys, indirectKeys, literalLocations } = extractUsage(
    files,
    new Set(keys),
  );

  const unused = keys.filter((key) => !allLiterals.has(key));
  const referenced = new Set<string>([...tKeys, ...indirectKeys]);
  const rawOnly = keys.filter(
    (key) => allLiterals.has(key) && !referenced.has(key),
  );
  const missing = [...referenced].filter((key) => !(key in dict)).sort();

  console.log(
    `Scanned ${files.length} files in ${relative(ROOT, SRC_DIR)}; ` +
      `${keys.length} keys in ${relative(ROOT, DICT_PATH)}.`,
  );

  printSection("Unused translation keys", unused);
  printRawOnly(rawOnly, literalLocations);
  printSection("Used in code but missing from zhCN.json", missing);

  if (unused.length === 0) {
    console.log("\nNo unused translation keys found.");
    return;
  }

  if (dryRun) {
    console.log("\nDry run: no changes written.");
    return;
  }

  if (!assumeYes && !stdin.isTTY) {
    console.log(
      "\nRefusing to modify the dictionary in a non-interactive session. " +
        "Re-run with --yes to confirm.",
    );
    process.exitCode = 1;
    return;
  }

  let confirmed = assumeYes;
  if (!confirmed) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const answer = (
        await rl.question(`\nRemove ${unused.length} unused key(s)? (y/N) `)
      )
        .trim()
        .toLowerCase();
      confirmed = answer === "y" || answer === "yes";
    } finally {
      rl.close();
    }
  }

  if (!confirmed) {
    console.log("Aborted. No changes written.");
    process.exitCode = 1;
    return;
  }

  const unusedSet = new Set(unused);
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    if (!unusedSet.has(key)) next[key] = dict[key];
  }

  writeFileSync(DICT_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(
    `\nRemoved ${unused.length} unused key(s) from ${relative(ROOT, DICT_PATH)}.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
