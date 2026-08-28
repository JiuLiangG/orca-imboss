import type { Employee, EmployeeInput } from "../../../shared/types";
import { readAvatarDataUrl } from "../../avatars";
import { getDB } from "../index";
import { parseNumberArray, parseStringArray, stringifyArray } from "./json";

interface EmployeeRow {
  id: number;
  name: string;
  role: string;
  system_prompt: string;
  mcp: string;
  skills: string;
  model_id: string | null;
  avatar: string | null;
}

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name ?? "",
    role: row.role ?? "",
    systemPrompt: row.system_prompt ?? "",
    mcp: parseStringArray(row.mcp),
    skills: parseStringArray(row.skills),
    modelId: row.model_id,
    avatar: row.avatar,
    // Main-owned file read; data URL (or null) is the only form ever sent
    // to the renderer — raw paths are not useful there.
    avatarUrl: readAvatarDataUrl(row.id),
  };
}

/** The built-in assistant's reserved id — it must always exist. */
export const ASSISTANT_ID = 0;

const SELECT_ALL = "SELECT * FROM employees ORDER BY id ASC";
const SELECT_BY_ID = "SELECT * FROM employees WHERE id = ?";

export function listEmployees(): Employee[] {
  return (getDB().prepare(SELECT_ALL).all() as EmployeeRow[]).map(toEmployee);
}

export function getEmployee(id: number): Employee | null {
  const row = getDB().prepare(SELECT_BY_ID).get(id) as EmployeeRow | undefined;
  return row ? toEmployee(row) : null;
}

/** Fetch the built-in assistant (id 0); never null thanks to seed + guards. */
export function getAssistant(): Employee | null {
  return getEmployee(ASSISTANT_ID);
}

function validateName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (name.length > 200) throw new Error("Name is too long.");
  return name;
}

function validateRole(role: string | undefined): string | undefined {
  if (role === undefined) return undefined;
  if (role.length > 200) throw new Error("Role is too long.");
  return role;
}

function validatePrompt(prompt: string | undefined): string | undefined {
  if (prompt === undefined) return undefined;
  if (prompt.length > 100_000) throw new Error("System prompt is too long.");
  return prompt;
}

/**
 * Validate an MCP/skill reference list defensively: strings only, sane length
 * caps, deduplicated preserving first-seen order. Names used for filesystem
 * operations are validated more strictly where those operations happen.
 */
function validateRefList(
  values: string[] | undefined,
  field: "mcp" | "skills",
): string[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new Error(`${field} must be an array.`);
  if (values.length > 256) throw new Error(`Too many ${field} entries.`);
  for (const value of values) {
    if (typeof value !== "string") {
      throw new Error(`${field} entries must be strings.`);
    }
    if (value.length === 0 || value.length > 256) {
      throw new Error(`${field} entry has invalid length.`);
    }
  }
  return [...new Set(values)];
}

/** Validate `model_id` — either NULL/empty or `"provider/modelId"` form. */
function validateModelId(modelId: string | null | undefined): string | null {
  if (modelId == null || modelId === "") return null;
  const valid = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(modelId);
  if (!valid) {
    throw new Error('Model id must look like "provider/model".');
  }
  return modelId;
}

export function createEmployee(input: EmployeeInput): Employee {
  const result = getDB()
    .prepare(
      "INSERT INTO employees (name, role, system_prompt, mcp, skills, model_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      validateName(input.name) ?? "",
      validateRole(input.role) ?? "",
      validatePrompt(input.systemPrompt) ?? "",
      stringifyArray(validateRefList(input.mcp, "mcp") ?? []),
      stringifyArray(validateRefList(input.skills, "skills") ?? []),
      validateModelId(input.modelId),
    );
  const created = getEmployee(Number(result.lastInsertRowid));
  if (!created) throw new Error("Failed to create employee.");
  return created;
}

export function updateEmployee(
  id: number,
  input: EmployeeInput,
): Employee | null {
  if (id === ASSISTANT_ID) {
    throw new Error("The built-in assistant cannot be modified here yet.");
  }
  const current = getEmployee(id);
  if (!current) return null;

  // Merge patch over current values; helpers validate only changed fields.
  const mcp =
    input.mcp !== undefined ? validateRefList(input.mcp, "mcp") : current.mcp;
  const skills =
    input.skills !== undefined
      ? validateRefList(input.skills, "skills")
      : current.skills;

  getDB()
    .prepare(
      "UPDATE employees SET name = ?, role = ?, system_prompt = ?, mcp = ?, skills = ?, model_id = ? WHERE id = ?",
    )
    .run(
      input.name !== undefined ? validateName(input.name) : current.name,
      input.role !== undefined ? validateRole(input.role) : current.role,
      input.systemPrompt !== undefined
        ? validatePrompt(input.systemPrompt)
        : current.systemPrompt,
      stringifyArray(mcp ?? []),
      stringifyArray(skills ?? []),
      input.modelId !== undefined
        ? validateModelId(input.modelId)
        : current.modelId,
      id,
    );
  return getEmployee(id);
}

/** Update the stored avatar file path (owner: avatar IPC handler). */
export function updateEmployeeAvatar(
  id: number,
  avatarPath: string | null,
): Employee | null {
  if (id === ASSISTANT_ID) {
    throw new Error("The built-in assistant cannot be modified here yet.");
  }
  getDB()
    .prepare("UPDATE employees SET avatar = ? WHERE id = ?")
    .run(avatarPath, id);
  return getEmployee(id);
}

/**
 * Delete a non-reserved employee. The sessions FK cascades in SQLite; this
 * additionally strips the employee's id from every chat's participants array
 * so stored JSON never references missing rows. Disk session-file cleanup is
 * coordinated above this service (see IPC wiring).
 */
export function deleteEmployee(id: number): boolean {
  if (id === ASSISTANT_ID) {
    throw new Error("The built-in assistant cannot be deleted.");
  }
  const db = getDB();
  const tx = db.transaction(() => {
    // Desktop scale: scan all chats and filter exactly rather than guessing
    // with LIKE patterns that can mis-candidate overlapping digits.
    const rows = db
      .prepare("SELECT id, participants FROM chats")
      .all() as Array<{ id: number; participants: string }>;
    for (const chat of rows) {
      const participants = parseNumberArray(chat.participants);
      if (participants.includes(id)) {
        db.prepare("UPDATE chats SET participants = ? WHERE id = ?").run(
          stringifyArray(participants.filter((pid) => pid !== id)),
          chat.id,
        );
      }
    }
    return db.prepare("DELETE FROM employees WHERE id = ?").run(id).changes > 0;
  });
  return tx();
}
