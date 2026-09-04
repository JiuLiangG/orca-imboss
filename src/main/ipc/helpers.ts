import type { PageQuery } from "@shared/types";

export function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  return value;
}

export function assertInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be an integer.`);
  }
  return value;
}

export function assertObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
} /** Validate a `PageQuery` payload defensively (cursor/query strings, sane limit). */

export function parsePageQuery(value: unknown): PageQuery {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("page query must be an object.");
  }
  const record = value as Record<string, unknown>;
  const page: PageQuery = {};
  if (record["cursor"] !== undefined && record["cursor"] !== null) {
    page.cursor = assertString(record["cursor"], "cursor");
  }
  if (record["query"] !== undefined && record["query"] !== null) {
    page.query = assertString(record["query"], "query");
  }
  if (record["limit"] !== undefined) {
    const limit = assertInteger(record["limit"], "limit");
    if (limit < 1 || limit > 200) {
      throw new Error("limit must be between 1 and 200.");
    }
    page.limit = limit;
  }
  return page;
}
