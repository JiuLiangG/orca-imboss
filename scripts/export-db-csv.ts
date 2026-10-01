#!/usr/bin/env node
/**
 * Export the `employees` and `settings` tables from the app's SQLite database
 * (`~/.imboss/db/imboss.db`) to CSV files.
 *
 * The database is opened **read-only**, so a running app keeps working and the
 * script can never migrate, lock or otherwise mutate the data.
 *
 * Usage:
 *   node scripts/export-db-csv.ts                      # ~/.imboss/exports/*.csv
 *   node scripts/export-db-csv.ts -o ./backup          # ./backup/*.csv
 *   node scripts/export-db-csv.ts --db /tmp/x.db --bom --quiet
 *
 * Options:
 *   -o, --out <dir>   Output directory (default: ~/.imboss/exports).
 *       --db <path>   Database file to read (default: ~/.imboss/db/imboss.db).
 *       --bom         Prefix each CSV with a UTF-8 BOM (Excel-friendly).
 *   -q, --quiet       Suppress per-file progress output.
 *   -h, --help        Show this help.
 *
 * Output is RFC 4180-style: CRLF row separators, minimal quoting, and embedded
 * double quotes doubled. NULL becomes an empty field; BLOBs are base64-encoded.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";

/** The tables to export, with a stable human-friendly ordering. */
const TABLES: ReadonlyArray<{ name: string; orderBy: string }> = [
  { name: "employees", orderBy: "id" },
  { name: "settings", orderBy: "key" },
];

/** UTF-8 byte order mark, prepended when `--bom` is set. */
const BOM = "\uFEFF";

function defaultDbPath(): string {
  return join(homedir(), ".imboss", "db", "imboss.db");
}

function defaultOutDir(): string {
  return join(homedir(), ".imboss", "exports");
}

/** Render a single database value as a CSV field (before escaping). */
function toField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  return String(value);
}

/** Quote a field when it contains a comma, quote, or line break. */
function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsvRow(fields: string[]): string {
  return fields.map(escapeField).join(",");
}

/** Export one table and return the number of data rows written. */
function exportTable(
  db: Database.Database,
  table: { name: string; orderBy: string },
  outPath: string,
  withBom: boolean,
): number {
  const statement = db.prepare(
    `SELECT * FROM "${table.name}" ORDER BY "${table.orderBy}"`,
  );
  const columns = statement.columns().map((column) => column.name);
  const lines = [toCsvRow(columns)];

  let count = 0;
  for (const row of statement.iterate() as IterableIterator<
    Record<string, unknown>
  >) {
    lines.push(toCsvRow(columns.map((column) => toField(row[column]))));
    count += 1;
  }

  const content = (withBom ? BOM : "") + lines.join("\r\n") + "\r\n";
  writeFileSync(outPath, content, { encoding: "utf8", mode: 0o600 });
  return count;
}

function printUsage(): void {
  console.log(
    [
      "Export the employees and settings tables to CSV.",
      "",
      "Usage: node scripts/export-db-csv.ts [options]",
      "",
      "Options:",
      "  -o, --out <dir>   Output directory (default: ~/.imboss/exports).",
      "      --db <path>   Database file to read (default: ~/.imboss/db/imboss.db).",
      "      --bom         Prefix each CSV with a UTF-8 BOM (Excel-friendly).",
      "  -q, --quiet       Suppress per-file progress output.",
      "  -h, --help        Show this help.",
    ].join("\n"),
  );
}

function main(): void {
  const { values } = parseArgs({
    options: {
      out: { type: "string", short: "o" },
      db: { type: "string" },
      bom: { type: "boolean", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help === true) {
    printUsage();
    return;
  }

  const dbPath = resolve(values.db ?? defaultDbPath());
  const outDir = resolve(values.out ?? defaultOutDir());
  const withBom = values.bom === true;
  const quiet = values.quiet === true;

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  mkdirSync(outDir, { recursive: true });

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    // Fail fast if the database needs a schema this script does not know about
    // (e.g. a pre-migration file); better to be loud than to export nothing.
    for (const table of TABLES) {
      const found = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table.name);
      if (found === undefined) {
        throw new Error(`Table not found in database: ${table.name}`);
      }
    }

    for (const table of TABLES) {
      const outPath = join(outDir, `${table.name}.csv`);
      const count = exportTable(db, table, outPath, withBom);
      if (!quiet) {
        console.log(`Exported ${count} row(s) -> ${outPath}`);
      }
    }
  } finally {
    db.close();
  }

  if (!quiet) {
    console.log(`Done. Files written to ${outDir}.`);
  }
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
