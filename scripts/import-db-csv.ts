#!/usr/bin/env node
/**
 * Import CSV files produced by `export-db-csv.ts` back into the app's SQLite
 * database (`~/.imboss/db/imboss.db`).
 *
 * Safety model:
 * - **Upsert by primary key** — rows are inserted, or updated in place when the
 *   key already exists. `INSERT OR REPLACE` is deliberately *not* used: on
 *   `employees` it would delete + re-insert the row, and the `ON DELETE
 *   CASCADE` foreign keys would silently wipe `sessions`, `read_cursors` and
 *   `cron_jobs`.
 * - Everything is parsed and validated **before** the first write, and each
 *   table is applied inside a single transaction — a bad file changes nothing.
 * - A consistent snapshot is taken with `VACUUM INTO` before writing
 *   (disable with `--no-backup`).
 * - Rows *absent* from the CSV are left untouched; this tool never deletes.
 *
 * Tip: quit the running app before importing so the two connections are not
 * competing for the SQLite write lock.
 *
 * Usage:
 *   node scripts/import-db-csv.ts                 # ~/.imboss/exports/*.csv
 *   node scripts/import-db-csv.ts -i ./backup      # ./backup/*.csv
 *   node scripts/import-db-csv.ts --dry-run        # validate + report only
 *   node scripts/import-db-csv.ts --yes            # skip the confirmation
 *
 * Options:
 *   -i, --in <dir>    Input directory (default: ~/.imboss/exports).
 *       --db <path>   Database file to write (default: ~/.imboss/db/imboss.db).
 *       --dry-run     Parse, validate and report; never writes.
 *   -y, --yes         Skip the interactive confirmation (required when stdin
 *                     is not a TTY).
 *       --no-backup   Skip the automatic pre-import backup.
 *   -q, --quiet       Suppress the per-table detail output.
 *   -h, --help        Show this help.
 *
 * CSV handling: UTF-8 (optional BOM), RFC 4180 quoting with embedded newlines,
 * CRLF or LF row separators. Empty fields become NULL for nullable columns and
 * the column default (or a type zero-value) for NOT NULL columns. BLOB columns
 * are base64-decoded, matching the exporter.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import * as readline from "node:readline/promises";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";

/** The tables to import, mirroring the exporter's fixed allowlist. */
const TABLES: readonly string[] = ["employees", "settings"];

/** A row of `PRAGMA table_info`. */
interface ColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  dfltValue: string | null;
  pk: number;
}

/** A fully validated, ready-to-apply table import. */
interface PreparedTable {
  table: string;
  csvPath: string;
  columns: ColumnInfo[];
  /** Header columns actually present in the CSV, in file order. */
  csvColumns: string[];
  rows: Array<Record<string, unknown>>;
  inserts: number;
  updates: number;
}

type Affinity = "INTEGER" | "REAL" | "TEXT" | "BLOB" | "NUMERIC";

function defaultDbPath(): string {
  return join(homedir(), ".imboss", "db", "imboss.db");
}

function defaultInDir(): string {
  return join(homedir(), ".imboss", "exports");
}

/**
 * Parse RFC 4180 CSV text (a leading UTF-8 BOM is ignored). Supports quoted
 * fields with embedded commas, double quotes (`""`) and newlines, and both
 * CRLF and LF row separators. Throws on an unterminated quoted field.
 */
function parseCsv(text: string): string[][] {
  let source = text;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (source[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw new Error("unterminated quoted field (unbalanced double quote)");
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/** SQLite column affinity for a declared type string. */
function affinityOf(type: string): Affinity {
  const t = type.toUpperCase();
  if (t.includes("INT")) return "INTEGER";
  if (t.includes("CHAR") || t.includes("CLOB") || t.includes("TEXT")) {
    return "TEXT";
  }
  if (t === "" || t.includes("BLOB")) return "BLOB";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) {
    return "REAL";
  }
  return "NUMERIC";
}

/** Parse a simple SQL literal default (string/number/NULL); else `undefined`. */
function parseDefaultLiteral(literal: string | null): unknown {
  if (literal === null) return undefined;
  const value = literal.trim();
  if (/^null$/i.test(value)) return null;
  if (/^'.*'$/s.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^[+-]?\d+$/.test(value)) return Number(value);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function zeroValue(affinity: Affinity): unknown {
  switch (affinity) {
    case "TEXT":
      return "";
    case "BLOB":
      return Buffer.alloc(0);
    default:
      return 0;
  }
}

function decodeBase64(value: string): Buffer {
  const cleaned = value.replace(/\s+/g, "");
  if (cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new Error("invalid base64");
  }
  return Buffer.from(cleaned, "base64");
}

/** Convert one CSV field to the value stored in a column of the given type. */
function coerce(raw: string, column: ColumnInfo): unknown {
  const affinity = affinityOf(column.type);

  if (raw === "") {
    if (!column.notnull) return null;
    const fallback = parseDefaultLiteral(column.dfltValue);
    return fallback !== undefined ? fallback : zeroValue(affinity);
  }

  switch (affinity) {
    case "INTEGER": {
      const value = raw.trim();
      if (!/^[+-]?\d+$/.test(value)) {
        throw new Error(`expected an integer, got ${JSON.stringify(raw)}`);
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error(`integer out of range: ${JSON.stringify(raw)}`);
      }
      return parsed;
    }
    case "REAL": {
      const parsed = Number(raw.trim());
      if (!Number.isFinite(parsed)) {
        throw new Error(`expected a number, got ${JSON.stringify(raw)}`);
      }
      return parsed;
    }
    case "BLOB":
      try {
        return decodeBase64(raw);
      } catch {
        throw new Error(`expected base64, got ${JSON.stringify(raw)}`);
      }
    case "NUMERIC": {
      const value = raw.trim();
      if (/^[+-]?\d+$/.test(value)) return Number(value);
      if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(value)) {
        return Number(value);
      }
      return raw;
    }
    default:
      return raw;
  }
}

function getColumnInfo(db: Database.Database, table: string): ColumnInfo[] {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    notnull: row.notnull === 1,
    dfltValue: row.dflt_value,
    pk: row.pk,
  }));
}

function assertTableExists(db: Database.Database, table: string): void {
  const found = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (found === undefined) {
    throw new Error(`Table not found in database: ${table}`);
  }
}

/** Primary-key column names in key order. */
function primaryKeyColumns(columns: ColumnInfo[]): string[] {
  return columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
}

function rowKey(record: Record<string, unknown>, pkColumns: string[]): string {
  return pkColumns.map((name) => String(record[name])).join("\u0000");
}

/** Read + validate one CSV file against the table schema. No writes. */
function prepareTable(
  db: Database.Database,
  table: string,
  csvPath: string,
): PreparedTable {
  assertTableExists(db, table);
  const columns = getColumnInfo(db, table);
  const byName = new Map(columns.map((column) => [column.name, column]));

  let rows: string[][];
  try {
    rows = parseCsv(readFileSync(csvPath, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${csvPath}: ${message}`);
  }

  if (rows.length === 0) {
    throw new Error(`${csvPath} is empty (expected a header row)`);
  }

  const header = rows[0].map((name) => name.trim());
  if (header.length === 0 || header.every((name) => name === "")) {
    throw new Error(`${csvPath} has an empty header row`);
  }

  const seenHeader = new Set<string>();
  for (const name of header) {
    if (name === "") {
      throw new Error(`${csvPath} has an empty column name in its header`);
    }
    if (seenHeader.has(name)) {
      throw new Error(`Duplicate column in ${csvPath} header: "${name}"`);
    }
    seenHeader.add(name);
    if (!byName.has(name)) {
      throw new Error(`Unknown column in ${csvPath}: "${name}"`);
    }
  }

  const pkColumns = primaryKeyColumns(columns);
  for (const name of pkColumns) {
    if (!seenHeader.has(name)) {
      throw new Error(
        `Missing primary-key column "${name}" in ${csvPath} header`,
      );
    }
  }

  const csvColumns = header.map((name) => byName.get(name)!.name);
  const records: Array<Record<string, unknown>> = [];
  const seenKeys = new Set<string>();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const recordNumber = index + 1;
    if (row.length !== header.length) {
      throw new Error(
        `${csvPath} row ${recordNumber}: expected ${header.length} field(s), got ${row.length}`,
      );
    }

    const record: Record<string, unknown> = {};
    for (let column = 0; column < csvColumns.length; column += 1) {
      const info = byName.get(csvColumns[column])!;
      try {
        record[info.name] = coerce(row[column], info);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${csvPath} row ${recordNumber}, column "${info.name}": ${message}`,
        );
      }
    }

    const key = rowKey(record, pkColumns);
    if (seenKeys.has(key)) {
      throw new Error(
        `${csvPath} row ${recordNumber}: duplicate primary key (${pkColumns.join(", ")} = ${key.replace(/\u0000/g, ", ")})`,
      );
    }
    seenKeys.add(key);

    records.push(record);
  }

  const existing = new Set<string>(
    (
      db
        .prepare(
          `SELECT ${pkColumns.map((name) => `"${name}"`).join(", ")} FROM "${table}"`,
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => rowKey(row, pkColumns)),
  );

  let updates = 0;
  for (const record of records) {
    if (existing.has(rowKey(record, pkColumns))) updates += 1;
  }

  return {
    table,
    csvPath,
    columns,
    csvColumns,
    rows: records,
    inserts: records.length - updates,
    updates,
  };
}

/** Upsert every prepared row inside a single transaction. */
function applyTable(db: Database.Database, prepared: PreparedTable): void {
  const { table, csvColumns, rows } = prepared;
  const quoted = csvColumns.map((name) => `"${name}"`).join(", ");
  const placeholders = csvColumns.map(() => "?").join(", ");
  const pkColumns = primaryKeyColumns(prepared.columns);
  const pkList = pkColumns.map((name) => `"${name}"`).join(", ");
  const updatable = csvColumns.filter((name) => !pkColumns.includes(name));

  const conflict =
    updatable.length > 0
      ? `DO UPDATE SET ${updatable
          .map((name) => `"${name}" = excluded."${name}"`)
          .join(", ")}`
      : "DO NOTHING";

  const statement = db.prepare(
    `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ` +
      `ON CONFLICT(${pkList}) ${conflict}`,
  );

  const runAll = db.transaction((items: Array<Record<string, unknown>>) => {
    for (const record of items) {
      statement.run(...csvColumns.map((name) => record[name]));
    }
  });

  runAll(rows);
}

function timestamp(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Consistent pre-import snapshot via SQLite's `VACUUM INTO`. */
function backupDatabase(db: Database.Database, dbPath: string): string {
  const base = `${basename(dbPath)}.${timestamp()}.bak`;
  let destination = join(dirname(dbPath), base);
  let suffix = 1;
  while (existsSync(destination)) {
    destination = join(dirname(dbPath), `${base}.${suffix}`);
    suffix += 1;
  }
  db.prepare("VACUUM INTO ?").run(destination);
  return destination;
}

function printUsage(): void {
  console.log(
    [
      "Import employees/settings CSV files back into the database.",
      "",
      "Usage: node scripts/import-db-csv.ts [options]",
      "",
      "Options:",
      "  -i, --in <dir>    Input directory (default: ~/.imboss/exports).",
      "      --db <path>   Database file to write (default: ~/.imboss/db/imboss.db).",
      "      --dry-run     Parse, validate and report; never writes.",
      "  -y, --yes         Skip the interactive confirmation.",
      "      --no-backup   Skip the automatic pre-import backup.",
      "  -q, --quiet       Suppress the per-table detail output.",
      "  -h, --help        Show this help.",
    ].join("\n"),
  );
}

async function confirm(question: string): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      in: { type: "string", short: "i" },
      db: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      "no-backup": { type: "boolean", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help === true) {
    printUsage();
    return;
  }

  const dbPath = resolve(values.db ?? defaultDbPath());
  const inDir = resolve(values.in ?? defaultInDir());
  const dryRun = values["dry-run"] === true;
  const assumeYes = values.yes === true;
  const noBackup = values["no-backup"] === true;
  const quiet = values.quiet === true;

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const sources = TABLES.map((table) => ({
    table,
    csvPath: join(inDir, `${table}.csv`),
  }));
  for (const source of sources) {
    if (!existsSync(source.csvPath)) {
      throw new Error(`CSV not found: ${source.csvPath}`);
    }
  }

  const db = new Database(dbPath, {
    readonly: dryRun,
    fileMustExist: true,
  });
  try {
    // Validate every table before touching anything.
    const prepared = sources.map((source) =>
      prepareTable(db, source.table, source.csvPath),
    );

    if (!quiet) {
      for (const item of prepared) {
        console.log(
          `${item.table}: ${item.rows.length} row(s) — ` +
            `${item.inserts} insert(s), ${item.updates} update(s) ` +
            `(from ${item.csvPath})`,
        );
      }
    }

    if (dryRun) {
      console.log("Dry run: validation passed, no changes written.");
      return;
    }

    const total = prepared.reduce((sum, item) => sum + item.rows.length, 0);
    if (total === 0) {
      console.log("Nothing to import.");
      return;
    }

    if (!assumeYes) {
      if (!stdin.isTTY) {
        console.log(
          "\nRefusing to modify the database in a non-interactive session. " +
            "Re-run with --yes to confirm.",
        );
        process.exitCode = 1;
        return;
      }
      const ok = await confirm(
        `\nUpsert ${total} row(s) into the database? This overwrites rows ` +
          `with matching keys. (y/N) `,
      );
      if (!ok) {
        console.log("Aborted. No changes written.");
        process.exitCode = 1;
        return;
      }
    }

    if (!noBackup) {
      const backup = backupDatabase(db, dbPath);
      if (!quiet) console.log(`Backup written to ${backup}`);
    }

    for (const item of prepared) {
      applyTable(db, item);
      if (!quiet) {
        console.log(`Imported ${item.rows.length} row(s) into ${item.table}.`);
      }
    }

    if (!quiet) console.log("Done.");
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
