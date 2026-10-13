export const BUILTIN_SET_CRON_MARKER = "builtin:imb_set_cronjob";
export const BUILTIN_REMOVE_CRON_MARKER = "builtin:imb_remove_cronjob";

/**
 * A built-in, code-shipped capability that can be assigned to an employee's
 * "Linked MCP" list next to real MCP server names. The assistant sees these
 * labels/descriptions when it lists assignable options; the renderer shows its
 * own translated strings for the same marker values.
 */
export interface BuiltinToolOption {
  value: string;
  label: string;
  description: string;
}

/**
 * The built-in tool options the assistant may link to an employee. Kept in the
 * shared constants (main-process safe) so the assistant path needs no i18n.
 */
export const BUILTIN_TOOL_OPTIONS: readonly BuiltinToolOption[] = [
  {
    value: BUILTIN_SET_CRON_MARKER,
    label: "Set cron job",
    description:
      "Lets the employee create or update its own scheduled (recurring) tasks in a chat it participates in.",
  },
  {
    value: BUILTIN_REMOVE_CRON_MARKER,
    label: "Remove cron job",
    description:
      "Lets the employee delete its own scheduled (recurring) tasks.",
  },
];
