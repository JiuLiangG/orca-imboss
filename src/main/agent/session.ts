import {
  ASSISTANT_ID,
  ASSISTANT_SYSTEM_PROMPT,
  BASE_TOOL_SNIPPETS,
} from "@shared/constants";
import type { AgentEnvironment } from "@shared/types";
import { getAgentRoot, getAgentSessionsDir, getWorkDir } from "../data-dir";
import { getEmployee } from "../db/services/employees";
import { listMcpServers } from "../db/services/mcp";
import { getSession } from "../db/services/sessions";
import { getSetting } from "../db/services/settings";
import { createTeamToolDefinitions } from "./builtin-tools";
import type { EmployeeToolEntry } from "./employee-prompt";
import { buildEmployeeSystemPrompt } from "./employee-prompt";
import { createMcpToolDefinitions, type AnyPiTool } from "./mcp";
import { getModelRuntime, type ModelRuntimeInstance } from "./model-runtime";
import { loadPiSdk, type PiSdk } from "./pi-sdk";
import { createShellToolDefinitions } from "./tools";

/** Model instance returned by the runtime's model registry. */
type PiModel = NonNullable<ReturnType<ModelRuntimeInstance["getModel"]>>;

/**
 * Pi-backed agent session.
 *
 * Each `prompt()` call spins up an isolated, in-memory Pi session
 * (`SessionManager.inMemory` / `SettingsManager.inMemory`) rooted at the
 * app's own `~/.imboss/agent` dir — never the host system's `~/.pi/agent`.
 * Environment guarantees for every subprocess the agent spawns:
 *
 * - bash + PowerShell tools are replaced by env-injected definitions
 *   (user env via each tool's `spawnHook` — see `tools.ts`);
 * - the employee's configured MCP servers are connected by the app-side
 *   bridge and their tools are registered (see `mcp.ts`; stdio servers get
 *   the merged user env too).
 *
 * Event streaming to the renderer is deferred work; for now the final
 * assistant reply text is captured from `turn_end` and returned to the
 * caller (`replyText`), which the chat pipeline persists.
 */

export interface AgentSessionContext {
  employeeId: number;
  chatId: number;
}

export interface AgentPromptResult {
  /** True when a real agent turn ran (a model was configured and answered). */
  replied: boolean;
  /** Final assistant reply text (all text content of the last `turn_end`). */
  replyText?: string;
}

/** Settings key holding the `provider/model` default (written by settings UI). */
const DEFAULT_MODEL_KEY = "defaultModel";

export class AgentSession {
  private _disposed = false;

  constructor(
    private readonly _env: AgentEnvironment,
    private readonly _context?: AgentSessionContext,
  ) {}

  /**
   * Run one agent turn for `message`.
   *
   * Returns `{ replied: false }` only when no usable model is configured at
   * all (the shared ModelRuntime's available snapshot is empty — no provider
   * has credentials). Otherwise the model reference resolves with fallback:
   * employee `modelId` → `defaultModel` setting → first available model.
   */
  async prompt(message: string): Promise<AgentPromptResult> {
    if (this._disposed) {
      throw new Error("AgentSession has been disposed.");
    }
    const pi = await loadPiSdk();

    const employee = this._context
      ? getEmployee(this._context.employeeId)
      : null;
    // The app's shared model store — a single ModelRuntime for the whole
    // process. Its default create-time availability check populates
    // `hasConfiguredAuth` from stored credentials; the network refresh runs
    // once at startup and after provider mutations (see model-runtime.ts).
    const modelRuntime = await getModelRuntime();

    const model = this._resolveModel(modelRuntime, employee?.modelId);
    if (!model) {
      return { replied: false };
    }

    // Working directory for the session & its shell tools: the app's own
    // isolated workdir (~/.imboss/workdir), not the user's home dir.
    const cwd = getWorkDir();
    return this._runTurn(pi, {
      cwd,
      message,
      model,
      modelRuntime,
      employeeSystemPrompt: employee?.systemPrompt ?? "",
      mcpServerNames: employee?.mcp ?? [],
      employeeId: employee?.id ?? this._context?.employeeId ?? -1,
      isAssistant: employee?.id === ASSISTANT_ID,
    });
  }

  /** Close MCP client connections opened by this session. */
  async dispose(): Promise<void> {
    this._disposed = true;
    if (this._closeMcp) {
      const close = this._closeMcp;
      this._closeMcp = undefined;
      await close();
    }
  }

  private _closeMcp: (() => Promise<void>) | undefined;

  private _resolveModel(
    modelRuntime: ModelRuntimeInstance,
    employeeModelId: string | null | undefined,
  ): PiModel | undefined {
    // Cascade: employee's own model → app default model → first available.
    // A stored reference can go stale (provider/key removed), so an
    // unresolvable reference falls through to the next level instead of
    // silently doing nothing.
    const refs: Array<string | null | undefined> = [
      employeeModelId?.trim(),
      getSetting(DEFAULT_MODEL_KEY),
    ];
    for (const ref of refs) {
      const model = this._resolveModelRef(modelRuntime, ref);
      if (model) return model;
    }
    return modelRuntime.getAvailableSnapshot()[0];
  }

  /** Resolve a single `"provider/modelId"` reference against the runtime. */
  private _resolveModelRef(
    modelRuntime: ModelRuntimeInstance,
    ref: string | null | undefined,
  ): PiModel | undefined {
    if (!ref) return undefined;
    const slash = ref.indexOf("/");
    if (slash <= 0 || slash === ref.length - 1) return undefined;
    const provider = ref.slice(0, slash);
    const modelId = ref.slice(slash + 1);
    const model = modelRuntime.getModel(provider, modelId);
    if (!model || !modelRuntime.hasConfiguredAuth(model.provider)) {
      return undefined;
    }
    return model;
  }

  private async _runTurn(
    pi: PiSdk,
    args: {
      cwd: string;
      message: string;
      model: PiModel;
      modelRuntime: ModelRuntimeInstance;
      employeeSystemPrompt: string;
      mcpServerNames: string[];
      employeeId: number;
      isAssistant: boolean;
    },
  ): Promise<AgentPromptResult> {
    const { cwd, message, model, modelRuntime } = args;

    // MCP servers configured for the employee (matched by name).
    const allServers = args.mcpServerNames.length > 0 ? listMcpServers() : [];
    const selected = allServers.filter((server) =>
      args.mcpServerNames.includes(server.name),
    );
    const mcp = await createMcpToolDefinitions(selected);
    this._closeMcp = mcp.close;

    try {
      const shellTools = await createShellToolDefinitions({ cwd });
      // Role-based team tools: the assistant orchestrates; participants just
      // work inside chats. Skipped when the session has no employee/chat context.
      const teamTools = this._context
        ? createTeamToolDefinitions({
            env: this._env,
            employeeId: this._context.employeeId,
            chatId: this._context.chatId,
            // Includes built-in opt-in markers (e.g. `builtin:imb_set_cronjob`)
            // alongside any MCP server names.
            mcp: args.mcpServerNames,
          })
        : [];
      const customTools: AnyPiTool[] = [
        ...shellTools,
        ...teamTools,
        ...mcp.tools,
      ];
      const activeToolNames = [
        "read",
        "bash",
        "edit",
        "write",
        ...(process.platform === "win32" ? ["powershell"] : []),
        ...customTools.map((tool) => tool.name),
      ];

      // Resume the persistent per-(employee, chat) session when a row exists;
      // otherwise start ephemeral. A stored-but-unreadable session file falls
      // back to in-memory rather than failing the turn.
      let sessionManager;
      const sessionRecord = this._context
        ? getSession(this._context.employeeId, this._context.chatId)
        : null;
      if (sessionRecord) {
        try {
          sessionManager = pi.SessionManager.open(
            sessionRecord.session,
            getAgentSessionsDir(),
            cwd,
          );
        } catch {
          sessionManager = pi.SessionManager.inMemory(cwd);
        }
      } else {
        sessionManager = pi.SessionManager.inMemory(cwd);
      }

      const settingsManager = pi.SettingsManager.inMemory();

      // Enumeration of the active tools for this employee-session's `[tools]`
      // block: the SDK core tools use their base snippets; MCP + team `imb_*`
      // tools use their `promptSnippet` (falling back to the description).
      const toolEntries = buildEmployeeToolEntries(
        activeToolNames,
        customTools,
      );

      // Current local date (`yyyy-MM-dd`) for the `Today is ...` line.
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      // Every employee session goes fully custom (decision 8): the SDK base
      // prompt is dropped and the app builds persona + `[builtinSkills]` +
      // `[tools]` + Today/Employee ID. The SDK still appends
      // `<project_context>`, `[skills]` and a trailing `Current working
      // directory` line after the override.
      const systemPromptOverride = (): string =>
        buildEmployeeSystemPrompt({
          personaParts: args.isAssistant
            ? [ASSISTANT_SYSTEM_PROMPT, args.employeeSystemPrompt]
            : [args.employeeSystemPrompt],
          employeeId: args.employeeId,
          toolEntries,
          today,
        });

      // Anchor `<project_context>` to the app's `~/.imboss/agent` dir only,
      // dropping any ancestor AGENTS.md files outside it (decision 5).
      const agentsFilesOverride = (base: {
        agentsFiles: Array<{ path: string; content: string }>;
      }) => {
        const root = getAgentRoot().replace(/\\/g, "/");
        const prefix = root.endsWith("/") ? root : `${root}/`;
        return {
          agentsFiles: base.agentsFiles.filter((f) => {
            const path = f.path.replace(/\\/g, "/");
            return path === root || path.startsWith(prefix);
          }),
        };
      };

      const resourceLoader = new pi.DefaultResourceLoader({
        cwd,
        agentDir: this._env.rootDir,
        settingsManager,
        systemPromptOverride,
        agentsFilesOverride,
      });
      await resourceLoader.reload();

      const { session } = await pi.createAgentSession({
        cwd,
        agentDir: this._env.rootDir,
        modelRuntime,
        model,
        tools: activeToolNames,
        customTools,
        resourceLoader,
        sessionManager,
        settingsManager,
      });

      let replyText = "";
      session.subscribe((event) => {
        if (event.type === "turn_end") {
          replyText = extractMessageText(event.message);
        }
      });

      await session.prompt(message);
      return { replied: true, replyText };
    } finally {
      if (this._closeMcp) {
        const close = this._closeMcp;
        this._closeMcp = undefined;
        await close();
      }
    }
  }
}

/**
 * Resolve the ordered entries for the `[tools]` block from a session's active
 * tool names. Core tools (read/bash/edit/write) map to `BASE_TOOL_SNIPPETS`;
 * custom tools (MCP + team `imb_*`) use their `promptSnippet` (falling back to
 * the description). Names that appear twice in `activeToolNames` (bash and
 * PowerShell are both base tools and shell definitions) are deduplicated.
 */
function buildEmployeeToolEntries(
  activeToolNames: string[],
  customTools: AnyPiTool[],
): EmployeeToolEntry[] {
  const byName = new Map<string, AnyPiTool>(
    customTools.map((tool) => [tool.name, tool]),
  );
  const entries: EmployeeToolEntry[] = [];
  const seen = new Set<string>();
  for (const name of activeToolNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const base = BASE_TOOL_SNIPPETS[name];
    if (base) {
      entries.push({ name, snippet: base });
      continue;
    }
    const custom = byName.get(name);
    const snippet = custom?.promptSnippet ?? custom?.description;
    if (custom && snippet) {
      entries.push({ name, snippet });
    }
  }
  return entries;
}

/**
 * Collect text content from an assistant message (`turn_end`): text blocks
 * joined by newlines; thinking/image blocks are skipped.
 */
function extractMessageText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const text = (block as { text: string }).text;
      if (text.trim().length > 0) parts.push(text);
    }
  }
  return parts.join("\n").trim();
}
