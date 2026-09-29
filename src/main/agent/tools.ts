import type { AnyPiTool } from "@shared/types";
import { loadPiSdk } from "./pi-sdk";
import { readUserEnv } from "./user-env";

/**
 * Pi shell tools with the user-configured environment applied.
 *
 * Pi has no session-wide `env` option and no native MCP support, so the
 * "whole agent session" environment guarantee is realized per shell tool via
 * its `spawnHook` (bash, plus PowerShell on Windows). The hook receives the
 * ctx with session metadata (`PI_*`) already injected and merges the user env
 * on top:
 * `{ ...ctx.env, ...readUserEnv() }` — explicit user configuration wins over
 * session metadata, while `process.env` stays the lowest layer so system
 * binaries remain findable (the `$PATH` guarantee).
 *
 * These definitions replace the built-ins of the same name (Pi's tool
 * registry gives custom tools precedence), so every shell command the agent
 * spawns inherits the user env. No `process.env` mutation is performed.
 *
 * Platform gating: the PowerShell definition is only built on Windows. On any
 * other host the tool must be absent — both from the session's tool allowlist
 * and from the generated `Available tools:` block of the system prompt.
 */

export interface ShellToolsOptions {
  /** Working directory for the shell tools. */
  cwd: string;
}

/**
 * Create the env-injected bash + PowerShell tool definitions.
 *
 * `bash` is always provided; `powershell` only on Windows (it is useless — and
 * misleading in the prompt — anywhere else).
 */
export async function createShellToolDefinitions(
  options: ShellToolsOptions,
): Promise<AnyPiTool[]> {
  const pi = await loadPiSdk();
  const definitions: AnyPiTool[] = [
    pi.createBashToolDefinition(options.cwd, { spawnHook: withUserEnv }),
  ];
  if (process.platform === "win32") {
    definitions.push(
      pi.createPowerShellToolDefinition(options.cwd, {
        spawnHook: withUserEnv,
      }),
    );
  }
  return definitions;
}

/** Merge the user env into the child-process env of one shell spawn. */
function withUserEnv(ctx: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): { command: string; cwd: string; env: NodeJS.ProcessEnv } {
  return { ...ctx, env: { ...ctx.env, ...readUserEnv() } };
}
