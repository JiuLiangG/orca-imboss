import {
  ASSISTANT_REPORT_PROMPT,
  buildEmployeeRolePrompt,
  BUILTIN_SKILLS,
  EMPLOYEE_REPORT_PROMPT,
  RESPONSE_LANGUAGE_PROMPT,
  TOOLS_GUIDELINES,
} from "@shared/constants/prompts";
import { BuildEmployeeSystemPromptArgs } from "@shared/types";

/**
 * Assemble an employee-session's system prompt under the app's own
 * `systemPromptOverride` (the Pi SDK customPrompt branch). Because the SDK
 * appends `<project_context>`, `[skills]` and a trailing
 * `Current working directory` line after the override, this function emits
 * the role, persona, `[builtinSkills]`, response-language rule, the `[tools]`
 * block and the `Today` / `Employee ID` lines (in that order). The exact
 * template shape:
 *
 * ```
 * [role: generated for non-assistants; baked into ASSISTANT_SYSTEM_PROMPT for the assistant]
 * [employeePrompt: persona]
 * [report skill: assistant aggregation/progress/summary OR employee result report]
 * [builtinSkills]
 * [response language]
 * [tools]
 * Today is {yyyy-MM-dd}
 * Employee ID: {ID}
 * ```
 */

export function buildEmployeeSystemPrompt({
  personaParts,
  isAssistant,
  name,
  role,
  employeeId,
  toolEntries,
  today,
}: BuildEmployeeSystemPromptArgs): string {
  const persona = personaParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");

  // The assistant's role text is baked into `ASSISTANT_SYSTEM_PROMPT`;
  // non-assistants get a generated block from their name/role.
  const roleBlock = isAssistant ? "" : buildEmployeeRolePrompt(name, role);

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

  // Role-specific reporting skill: the assistant aggregates employee reports into
  // boss-facing progress + a summary; a non-assistant reports finished work to its
  // assigner.
  const reportBlock = isAssistant
    ? ASSISTANT_REPORT_PROMPT
    : EMPLOYEE_REPORT_PROMPT;

  const sections = [
    roleBlock,
    persona,
    reportBlock,
    BUILTIN_SKILLS,
    RESPONSE_LANGUAGE_PROMPT,
    toolsBlock,
    metaBlock,
  ];

  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}
