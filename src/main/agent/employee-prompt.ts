import { BUILTIN_SKILLS, TOOLS_GUIDELINES } from "@shared/constants";

/**
 * One entry for the `[tools]` block's `Available tools` list. The base SDK
 * tools (read/bash/edit/write) use `BASE_TOOL_SNIPPETS`; custom tools
 * (MCP + team `imb_*`) use their `promptSnippet` (falling back to the
 * description).
 */
export interface EmployeeToolEntry {
  name: string;
  snippet: string;
}

export interface BuildEmployeeSystemPromptArgs {
  /** Persona parts joined before the built-in skills; empty strings dropped.
   *  Assistant: `[ASSISTANT_SYSTEM_PROMPT, employee.systemPrompt]`.
   *  Regular:   `[employee.systemPrompt]`. */
  personaParts: string[];
  /** Employee id (assistant = 0). */
  employeeId: number;
  /** Active tools for this employee-session (core + MCP + team `imb_*`). */
  toolEntries: EmployeeToolEntry[];
  /** Current date in `yyyy-MM-dd`. */
  today: string;
}

/**
 * Assemble an employee-session's system prompt under the app's own
 * `systemPromptOverride` (the Pi SDK customPrompt branch). Because the SDK
 * appends `<project_context>`, `[skills]` and a trailing
 * `Current working directory` line after the override, this function emits
 * the persona, `[builtinSkills]`, the `[tools]` block and the
 * `Today` / `Employee ID` lines (in that order). The exact template shape:
 *
 * ```
 * [employeePrompt: persona + [builtinSkills]]
 * [tools]
 * Today is {yyyy-MM-dd}
 * Employee ID: {ID}
 * ```
 */
export function buildEmployeeSystemPrompt({
  personaParts,
  employeeId,
  toolEntries,
  today,
}: BuildEmployeeSystemPromptArgs): string {
  const persona = personaParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");

  const toolsBlock = [
    "Available tools:",
    ...toolEntries.map((entry) => `- ${entry.name}: ${entry.snippet}`),
    "",
    "Guidelines:",
    ...TOOLS_GUIDELINES.map((guideline) => `- ${guideline}`),
  ].join("\n");

  const metaBlock = [`Today is ${today}`, `Employee ID: ${employeeId}`].join(
    "\n",
  );

  const sections = [persona, BUILTIN_SKILLS, toolsBlock, metaBlock];

  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}
