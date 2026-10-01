import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentSkillsDir, getBuiltinSkillsDir } from "../data-dir";
import { getMcpConfigPath } from "../mcp-store";

/**
 * The app's built-in (code-shipped) Agent Skills.
 *
 * These are ordinary `SKILL.md` folders, but they live in a dedicated dir
 * (`~/.imboss/agent/builtin-skills`, see `getBuiltinSkillsDir`) instead of the
 * user skills dir, so the Skills module — which lists only
 * `~/.imboss/agent/skills` — never shows them. They are generated on disk at
 * startup (and defensively before an assistant session is built) because the
 * Pi SDK advertises a skill by its absolute `SKILL.md` path and the model loads
 * it with the `read` tool; an in-memory skill cannot be read back.
 *
 * Their content is instructions, not an integration: the assistant performs
 * the actual MCP/Skill changes with its existing `read`/`write`/`edit`/`bash`
 * tools, so no new tools are registered. Absolute paths are templated into the
 * bodies at generation time.
 *
 * Writes are best-effort and idempotent: a failure is logged and never throws,
 * and a file that already matches is left untouched.
 */

/** Folder name of a skill's entry file (Agent Skills standard). */
const SKILL_FILE = "SKILL.md";

/** Names of the built-in skills, in the order they are advertised. */
export const BUILTIN_SKILL_NAMES = [
  "mcp-management",
  "skills-management",
] as const;

export type BuiltinSkillName = (typeof BUILTIN_SKILL_NAMES)[number];

/** Whether `name` is one of the app's built-in skills. */
export function isBuiltinSkillName(name: string): name is BuiltinSkillName {
  return (BUILTIN_SKILL_NAMES as readonly string[]).includes(name);
}

/** Frontmatter `description` (single line; what makes the skill discoverable). */
const MCP_MANAGEMENT_DESCRIPTION =
  "View, add, edit, or remove this app's MCP server settings. " +
  "Use when the boss asks to manage, inspect, add, change, or delete MCP servers.";

const SKILLS_MANAGEMENT_DESCRIPTION =
  "View, add, edit, or delete this app's user-installed Skills. " +
  "Use when the boss asks to manage, inspect, add, change, or remove skills.";

interface BuiltinSkillFile {
  name: BuiltinSkillName;
  description: string;
  body: string;
}

/** Render one skill folder's `SKILL.md` (frontmatter + body). */
function renderSkillFile(skill: BuiltinSkillFile): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}`;
}

function mcpManagementSkillBody(): string {
  const mcpPath = getMcpConfigPath();
  return `# MCP management

You manage this app's MCP (Model Context Protocol) server settings. The single
source of truth is this JSON file:

    ${mcpPath}

The app reads the file when it builds an agent session, so a change takes effect
the next time a session starts, not immediately.

## File format

The file is a JSON object with one top-level key, "mcpServers", whose value is an
object keyed by server name:

    {
      "mcpServers": {
        "local-tools": {
          "command": "npx",
          "args": ["-y", "some-mcp-server"],
          "env": { "API_KEY": "..." },
          "description": "optional text shown to the model"
        },
        "remote-tools": {
          "url": "https://example.com/mcp",
          "headers": { "Authorization": "Bearer ..." },
          "description": "optional text shown to the model"
        }
      }
    }

- A server with "command" is a stdio server. "args" must be a JSON array of
  strings, never a single string.
- A server with "url" is an HTTP (streamable HTTP) server. SSE is not supported.
- "env" (stdio) and "headers" (HTTP) are optional objects of string values.
- "description" is optional and is passed to the model as the server description.

## Constraints (entries that break these are dropped by the app)

- Server name: 1-200 characters, only letters, digits, underscore and dash.
- "command": non-empty, at most 2048 characters.
- "args": at most 8192 characters in total.
- "url": at most 2048 characters and must start with http:// or https://.
- "env" keys must match ^[A-Za-z_][A-Za-z0-9_]*$.
- "env" and "headers" hold at most 128 entries each.
- Keep any other per-server fields you find (for example "enabled" or "timeout");
  the app preserves them and relies on them.

## How to work

1. Always read the file first. If it does not exist, create it as
   { "mcpServers": {} }.
2. To view servers, read the file and summarize each server's name and transport.
3. To add a server, edit the file to add a new key under "mcpServers" while
   leaving the existing servers untouched.
4. To edit a server, make a targeted edit. Keep only the fields of its transport;
   never leave both "command" and "url" on the same server.
5. To remove a server, delete that one key; do not remove the others.

Never write invalid JSON and never overwrite the file in a way that drops servers
you did not intend to change. When done, tell the boss what changed and that it
applies from the next session.
`;
}

function skillsManagementSkillBody(): string {
  const skillsDir = getAgentSkillsDir();
  const builtinDir = getBuiltinSkillsDir();
  return `# Skills management

You manage this app's user-installed Skills. A Skill is a folder containing a
SKILL.md file (the Agent Skills standard). User Skills live under:

    ${skillsDir}

Each skill is ${skillsDir}/<name>/SKILL.md, optionally with supporting files such
as scripts/, references/ or assets/ next to it. The app lists these skills in its
Skills module, and any employee that has selected a skill sees its name and
description.

Sessions pick up skills when they are built, so a new or changed skill applies on
the next turn of an employee session.

## SKILL.md format

    ---
    name: my-skill
    description: What the skill does and when to use it.
    ---

    # My skill

    Step-by-step instructions for the model.

- "name" must be lowercase letters, digits and hyphens (^[a-z0-9-]+$), at most 64
  characters, and must not start or end with a hyphen or contain two hyphens in a
  row.
- "description" is required (1-1024 characters). It is what makes the skill
  discoverable, so state both what the skill does and when it applies.
- Keep the folder name identical to the frontmatter name.
- Relative paths inside a skill resolve against the skill folder.

## How to work

1. To view skills, list the folders under ${skillsDir} that contain a SKILL.md and
   read each SKILL.md. The folder name is the skill name and the frontmatter
   "description" is its description.
2. To add a skill, write ${skillsDir}/<name>/SKILL.md with the frontmatter and
   instructions above. Use the write tool; it creates the parent folders. Add any
   supporting files under the same folder.
3. To edit a skill, read its SKILL.md and make a targeted edit; update the
   description if the skill's scope changed.
4. To delete a skill, remove exactly its folder, for example:
   rm -rf "${skillsDir}/<name>"
   Never delete ${skillsDir} itself.

## Built-in skills

The app also ships built-in skills under:

    ${builtinDir}

Those (currently mcp-management and skills-management) belong to the app. Never
edit, move or delete them. They are intentionally not listed in the Skills module.
`;
}

function builtinSkillFiles(): BuiltinSkillFile[] {
  return [
    {
      name: "mcp-management",
      description: MCP_MANAGEMENT_DESCRIPTION,
      body: mcpManagementSkillBody(),
    },
    {
      name: "skills-management",
      description: SKILLS_MANAGEMENT_DESCRIPTION,
      body: skillsManagementSkillBody(),
    },
  ];
}

/**
 * Write the built-in skills onto disk. Idempotent (a current file is left
 * untouched) and best-effort (a failure is logged, never thrown), so a broken
 * skill can never block startup or an assistant session.
 */
export function materializeBuiltinSkills(): void {
  const root = getBuiltinSkillsDir();
  for (const skill of builtinSkillFiles()) {
    const dir = join(root, skill.name);
    const file = join(dir, SKILL_FILE);
    const content = renderSkillFile(skill);
    try {
      if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, content, "utf8");
    } catch (err) {
      console.error(
        `[builtin-skills] failed to write ${skill.name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
