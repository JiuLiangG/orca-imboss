/**
 * Read `name` and `description` out of a SKILL.md head for the skills list.
 * Informational only: a malformed file yields nulls, and the model still loads
 * the file itself. Description follows the Agent Skills limit of 1024
 * characters. A YAML block (`|` or `>`) is joined; the block marker is not
 * shown as the description.
 */

const DESCRIPTION_MAX = 1024;

const BLOCK_MARK = /^([>|])([+-]?)(\d*)$/;

function cleanToken(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // YAML single quotes escape a quote by doubling it. Other values keep the
  // previous one-character strip, so a double-quoted description is unchanged.
  const cleaned =
    trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")
      ? trimmed.slice(1, -1).replaceAll("''", "'")
      : trimmed.replace(/^["']|["']$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function clampDescription(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > DESCRIPTION_MAX
    ? trimmed.slice(0, DESCRIPTION_MAX)
    : trimmed;
}

/** Frontmatter body when the head opens with `---`; otherwise the whole head. */
function descriptionSource(head: string): string {
  if (!head.startsWith("---")) return head;
  const rest = head.slice(3).replace(/^\r?\n/, "");
  const end = rest.search(/\r?\n---(?:\s|$)/);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function joinBlock(lines: string[], folded: boolean): string {
  if (!folded) return lines.join("\n");
  const paragraphs: string[] = [];
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length === 0) return;
    paragraphs.push(buf.join(" "));
    buf = [];
  };
  for (const line of lines) {
    if (line.trim() === "") flush();
    else buf.push(line.trim());
  }
  flush();
  return paragraphs.join("\n\n");
}

function parseDescription(source: string): string | null {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^description:\s*(.*)$/.exec(lines[i] ?? "");
    if (!match) continue;
    const rest = (match[1] ?? "").trim();
    const block = BLOCK_MARK.exec(rest);
    if (block) {
      const folded = block[1] === ">";
      const collected: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j] ?? "";
        if (line.trim() === "") {
          collected.push("");
          continue;
        }
        if (!/^[ \t]/.test(line)) break;
        collected.push(line.trim());
      }
      return clampDescription(joinBlock(collected, folded));
    }
    if (rest.length === 0) return null;
    return clampDescription(cleanToken(rest) ?? "");
  }
  return null;
}

export function parseSkillFrontmatter(head: string): {
  name: string | null;
  description: string | null;
} {
  const nameMatch = /^name:\s*(.+)$/m.exec(head);
  return {
    name: cleanToken(nameMatch?.[1]),
    description: parseDescription(descriptionSource(head)),
  };
}
