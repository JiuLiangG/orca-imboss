import { loadPiSdk } from "./pi-sdk";
import { readUserEnv } from "./user-env";
import type { AnyPiTool } from "./mcp";

/**
 * Pi shell tools with the user-configured environment applied.
 *
 * Pi has no session-wide `env` option and no native MCP support, so the
 * "whole agent session" environment guarantee is realized per shell tool via
 * its `spawnHook` (bash + PowerShell). The hook receives the ctx with session
 * metadata (`PI_*`) already injected and merges the user env on top:
 * `{ ...ctx.env, ...readUserEnv() }` — explicit user configuration wins over
 * session metadata, while `process.env` stays the lowest layer so system
 * binaries remain findable (the `$PATH` guarantee).
 *
 * These definitions replace the built-ins of the same name (Pi's tool
 * registry gives custom tools precedence), so every shell command the agent
 * spawns inherits the user env. No `process.env` mutation is performed.
 */

export interface ShellToolsOptions {
  /** Working directory for the shell tools. */
  cwd: string;
}

/** Merge the user env into the child-process env of one shell spawn. */
function withUserEnv(ctx: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): { command: string; cwd: string; env: NodeJS.ProcessEnv } {
  return { ...ctx, env: { ...ctx.env, ...readUserEnv() } };
}

/**
 * Create the env-injected bash + PowerShell tool definitions.
 *
 * `bash` is always provided; `powershell` is provided as well (used on
 * Windows, harmless elsewhere).
 */
export async function createShellToolDefinitions(
  options: ShellToolsOptions,
): Promise<AnyPiTool[]> {
  const pi = await loadPiSdk();
  return [
    pi.createBashToolDefinition(options.cwd, { spawnHook: withUserEnv }),
    pi.createPowerShellToolDefinition(options.cwd, { spawnHook: withUserEnv }),
  ];
}
