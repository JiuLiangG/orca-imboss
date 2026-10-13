import { SPEND_TREND_MAX_DAYS } from "@shared/constants/spend";
import type {
  SpendDayBreakdown,
  SpendEmployeeReport,
  SpendModelBreakdown,
  SpendRange,
  SpendReport,
  SpendTotals,
} from "@shared/types";
import type { FileEntry } from "@earendil-works/pi-coding-agent";
import { readFile, stat } from "fs/promises";
import { loadPiSdk } from "./agent/pi-sdk";
import { listEmployeeIdentities } from "./db/employees";
import { getDB } from "./db/index";

/**
 * Usage statistics aggregated from the persisted Pi session JSONL files.
 *
 * The report is computed by streaming those files (nothing is mirrored in
 * SQLite); a per-file `(mtimeMs, size)` cache keeps a revisit cheap and
 * reparses only sessions that changed. A malformed or unreadable session is
 * skipped rather than failing the whole report.
 *
 * Tool-result usage (`message.role === "toolResult"`) is deliberately ignored:
 * it covers nested calls outside the main loop's accounting, and counting it
 * alongside the assistant responses would double count that spend.
 */

/** One provider call's usage, flattened for aggregation. */
interface SpendRecord {
  /** Epoch ms; 0 when the entry carried no parseable timestamp. */
  ts: number;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

/** Token + cost payload read off a `Usage` object. */
type SpendCounters = Omit<SpendRecord, "ts" | "provider" | "model">;

interface CachedSession {
  mtimeMs: number;
  size: number;
  records: SpendRecord[];
}

/** Parsed usage per session file, invalidated by mtime/size. */
const sessionCache = new Map<string, CachedSession>();

/** Concurrent session-file reads, so a long history cannot exhaust memory. */
const READ_CONCURRENCY = 4;

interface SessionRow {
  employee_id: number;
  chat_id: number;
  session: string;
}

/** Accumulator used for both the grand total and each employee. */
interface Accumulator {
  totals: SpendTotals;
  byModel: Map<string, SpendModelBreakdown>;
  byDay: Map<string, SpendDayBreakdown>;
  chats: Set<number>;
}

/** Build the usage report for `range` (the `spend:report` IPC payload). */
export async function buildSpendReport(
  range: SpendRange,
): Promise<SpendReport> {
  const now = Date.now();
  const cutoff = rangeCutoff(range, now);
  const rows = getDB()
    .prepare("SELECT employee_id, chat_id, session FROM sessions")
    .all() as SessionRow[];
  const identities = new Map(
    listEmployeeIdentities().map((identity) => [identity.id, identity]),
  );

  const perEmployee = new Map<number, Accumulator>();
  const grand = createAccumulator();

  const parsed = await mapLimit(rows, READ_CONCURRENCY, async (row) => ({
    row,
    records: await recordsForSession(row.session),
  }));

  for (const { row, records } of parsed) {
    for (const record of records) {
      // Records without a timestamp only count in "all time" (cutoff 0).
      if (cutoff > 0 && (record.ts === 0 || record.ts < cutoff)) continue;
      addRecord(accumulatorFor(perEmployee, row.employee_id), record, row);
      addRecord(grand, record, row);
    }
  }

  const employees: SpendEmployeeReport[] = [...perEmployee.entries()]
    .map(([employeeId, accumulator]) => {
      const identity = identities.get(employeeId);
      return {
        employeeId,
        name: identity?.name ?? `Employee #${employeeId}`,
        role: identity?.role ?? "",
        chats: accumulator.chats.size,
        totals: accumulator.totals,
        byModel: sortModels([...accumulator.byModel.values()]),
        byDay: fillDays(accumulator.byDay, range, now),
      };
    })
    .filter((employee) => employee.totals.calls > 0)
    .sort(compareByCost);

  return {
    range,
    generatedAt: now,
    totals: grand.totals,
    byModel: sortModels([...grand.byModel.values()]),
    byDay: fillDays(grand.byDay, range, now),
    employees,
  };
}

function createAccumulator(): Accumulator {
  return {
    totals: emptyTotals(),
    byModel: new Map(),
    byDay: new Map(),
    chats: new Set(),
  };
}

function accumulatorFor(
  map: Map<number, Accumulator>,
  employeeId: number,
): Accumulator {
  let accumulator = map.get(employeeId);
  if (!accumulator) {
    accumulator = createAccumulator();
    map.set(employeeId, accumulator);
  }
  return accumulator;
}

function addRecord(
  accumulator: Accumulator,
  record: SpendRecord,
  row: SessionRow,
): void {
  addCounters(accumulator.totals, record);
  accumulator.chats.add(row.chat_id);

  const key = `${record.provider}\u0000${record.model}`;
  let model = accumulator.byModel.get(key);
  if (!model) {
    model = {
      provider: record.provider,
      model: record.model,
      totals: emptyTotals(),
    };
    accumulator.byModel.set(key, model);
  }
  addCounters(model.totals, record);

  if (record.ts > 0) {
    const date = localDay(record.ts);
    let day = accumulator.byDay.get(date);
    if (!day) {
      day = { date, totals: emptyTotals() };
      accumulator.byDay.set(date, day);
    }
    addCounters(day.totals, record);
  }
}

function emptyTotals(): SpendTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    calls: 0,
  };
}

function addCounters(totals: SpendTotals, counters: SpendCounters): void {
  totals.input += counters.input;
  totals.output += counters.output;
  totals.cacheRead += counters.cacheRead;
  totals.cacheWrite += counters.cacheWrite;
  totals.totalTokens += counters.totalTokens;
  totals.cost += counters.cost;
  totals.calls += 1;
}

/** Read + cache one session file's usage records (never throws). */
async function recordsForSession(sessionPath: string): Promise<SpendRecord[]> {
  try {
    const info = await stat(sessionPath);
    const cached = sessionCache.get(sessionPath);
    if (
      cached &&
      cached.mtimeMs === info.mtimeMs &&
      cached.size === info.size
    ) {
      return cached.records;
    }
    const content = await readFile(sessionPath, "utf8");
    const pi = await loadPiSdk();
    const records = parseSpendRecords(pi.parseSessionEntries(content));
    sessionCache.set(sessionPath, {
      mtimeMs: info.mtimeMs,
      size: info.size,
      records,
    });
    return records;
  } catch (err) {
    console.error(
      `[spend] failed to read session ${sessionPath}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Flatten every usage-carrying entry of one session, in append order. */
function parseSpendRecords(entries: FileEntry[]): SpendRecord[] {
  const records: SpendRecord[] = [];
  // Model in effect for entries that do not name one themselves.
  let provider = "";
  let model = "";

  for (const entry of entries) {
    if (entry.type === "model_change") {
      provider = nonEmpty(entry.provider) ?? provider;
      model = nonEmpty(entry.modelId) ?? model;
      continue;
    }
    if (entry.type === "message") {
      const message = entry.message as unknown as
        | {
            role?: unknown;
            provider?: unknown;
            model?: unknown;
            timestamp?: unknown;
            usage?: unknown;
          }
        | undefined;
      if (!message || message.role !== "assistant") continue;
      const counters = readCounters(message.usage);
      if (!counters) continue;
      records.push({
        ts: entryTime(entry) || numericTime(message.timestamp),
        provider: nonEmpty(message.provider) ?? provider,
        model: nonEmpty(message.model) ?? model,
        ...counters,
      });
      continue;
    }
    if (entry.type === "usage") {
      const counters = readCounters(entry.usage);
      if (!counters) continue;
      records.push({
        ts: entryTime(entry),
        provider: nonEmpty(entry.provider) ?? provider,
        model: nonEmpty(entry.model) ?? model,
        ...counters,
      });
      continue;
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const counters = readCounters(entry.usage);
      if (!counters) continue;
      records.push({
        ts: entryTime(entry),
        provider,
        model,
        ...counters,
      });
    }
  }
  return records;
}

/** Read the token + cost counters off a `Usage`-shaped value. */
function readCounters(value: unknown): SpendCounters | null {
  if (value === null || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const input = count(usage.input);
  const output = count(usage.output);
  const cacheRead = count(usage.cacheRead);
  const cacheWrite = count(usage.cacheWrite);
  // Providers report `totalTokens`; fall back to the parts when absent.
  const totalTokens = count(usage.totalTokens);
  const cost = readCost(usage.cost);
  if (input + output + cacheRead + cacheWrite + totalTokens + cost === 0) {
    return null;
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens:
      totalTokens > 0 ? totalTokens : input + output + cacheRead + cacheWrite,
    cost,
  };
}

function readCost(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  return count((value as Record<string, unknown>).total);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Entry-level ISO timestamp → epoch ms (0 when unparseable). */
function entryTime(entry: { timestamp?: unknown }): number {
  if (typeof entry.timestamp !== "string") return 0;
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Message-level epoch timestamp, accepted only when it looks like ms. */
function numericTime(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 1e11
    ? value
    : 0;
}

/** Local `YYYY-MM-DD` for an epoch-ms value. */
function localDay(ms: number): string {
  return dayKey(new Date(ms));
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Start of the requested window (0 = everything). */
function rangeCutoff(range: SpendRange, now: number): number {
  if (range === "all") return 0;
  const start = startOfToday(now);
  if (range === "today") return start;
  const days = range === "7d" ? 7 : 30;
  const from = new Date(start);
  from.setDate(from.getDate() - (days - 1));
  return from.getTime();
}

function startOfToday(now: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/**
 * Dense day series for the trend chart: every day of the window up to today,
 * with empty days materialized as zeroes. "All time" starts at the first
 * recorded day but is capped to the most recent `SPEND_TREND_MAX_DAYS` days.
 */
function fillDays(
  byDay: Map<string, SpendDayBreakdown>,
  range: SpendRange,
  now: number,
): SpendDayBreakdown[] {
  const today = new Date(startOfToday(now));
  const first = new Date(today);
  if (range === "7d") {
    first.setDate(first.getDate() - 6);
  } else if (range === "30d") {
    first.setDate(first.getDate() - 29);
  } else if (range === "all") {
    const earliest = [...byDay.keys()].sort()[0];
    if (earliest !== undefined) first.setTime(parseDayKey(earliest));
  }

  const cap = new Date(today);
  cap.setDate(cap.getDate() - (SPEND_TREND_MAX_DAYS - 1));
  const start = first.getTime() > cap.getTime() ? first : cap;

  const days: SpendDayBreakdown[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= today.getTime()) {
    const date = dayKey(cursor);
    days.push(byDay.get(date) ?? { date, totals: emptyTotals() });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Local midnight for a `YYYY-MM-DD` key. */
function parseDayKey(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

function sortModels(models: SpendModelBreakdown[]): SpendModelBreakdown[] {
  return models.sort(
    (a, b) =>
      b.totals.cost - a.totals.cost ||
      b.totals.totalTokens - a.totals.totalTokens,
  );
}

function compareByCost(a: SpendEmployeeReport, b: SpendEmployeeReport): number {
  return (
    b.totals.cost - a.totals.cost ||
    b.totals.totalTokens - a.totals.totalTokens ||
    a.employeeId - b.employeeId
  );
}

/** Run `fn` over `items` with at most `limit` promises in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
