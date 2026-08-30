/**
 * Smoke test for the keyset-paged list endpoints (run in isolation via a
 * temporary HOME so the real `~/.imboss` data folder is never touched):
 *
 *   HOME=/tmp/imboss-smoke pnpm exec esbuild scripts/smoke-paging.ts --bundle \
 *     --platform=node --external:better-sqlite3 --outfile=/tmp/smoke-paging.cjs
 *   node /tmp/smoke-paging.cjs
 *
 * Verifies cursor stability, `hasMore` correctness, FTS (≥3 chars) vs LIKE
 * (short) vs union semantics, and no-skip/no-dup keyset behavior under
 * concurrent inserts.
 */
import { initDatabase, getDB } from "../src/main/db";
import {
  createChat,
  listChatSummariesPage,
} from "../src/main/db/services/chats";
import { listEmployeesPage } from "../src/main/db/services/employees";
import { listMcpServersPage } from "../src/main/db/services/mcp";
import { appendMessage } from "../src/main/db/services/messages";
import { installSkillsFromFolders, listSkillsPage } from "../src/main/agent/skills";
import { listProvidersPage } from "../src/main/agent/providers";
import {
  getAgentSkillsDir,
  getAuthPath,
  getModelsPath,
} from "../src/main/data-dir";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

async function main(): Promise<void> {
  const db = initDatabase();

  // --- chats: keyset walk, no skip/dup, hasMore correctness -----------------
  for (let i = 0; i < 7; i += 1) {
    const chat = createChat(`chat-${i}`, []);
    appendMessage(
      chat.id,
      null,
      `hello from chat ${i} ${i > 3 ? "alpha" : "beta"}`,
    );
  }

  const seen: number[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = listChatSummariesPage({ limit: 3, cursor });
    console.log(
      `chats page ${pages + 1}: ${page.items.length} items, hasMore=${page.hasMore}`,
    );
    for (const item of page.items) seen.push(item.id);
    assert(
      seen.length === new Set(seen).size,
      "chats: no duplicate rows across pages",
    );
    cursor = page.nextCursor;
    pages += 1;
    assert(page.items.length <= 3, "chats: page size respected");
    if (pages > 10) break;
  } while (cursor !== null);
  assert(
    seen.length === 7,
    `chats: all 7 chats visited exactly once (got ${seen.length})`,
  );
  assert(pages === 3, `chats: 7 items at limit 3 → 3 pages (got ${pages})`);

  // --- chat search union: FTS (>=3 chars) vs LIKE (<3) ----------------------
  const fts = listChatSummariesPage({ limit: 10, query: "alpha" });
  assert(
    fts.items.length === 3,
    `chats: FTS "alpha" → 3 hits (got ${fts.items.length})`,
  );
  const like = listChatSummariesPage({ limit: 10, query: "al" });
  assert(
    like.items.length === 3,
    `chats: LIKE "al" → 3 hits (got ${like.items.length})`,
  );
  const union = listChatSummariesPage({ limit: 10, query: "chat-1" });
  assert(
    union.items.some((c) => c.title === "chat-1"),
    "chats: title match with FTS query (union semantics)",
  );
  assert(
    listChatSummariesPage({ limit: 10, query: "zzzzzz" }).items.length === 0,
    "chats: no-match query returns empty",
  );

  // --- keyset stability under fresh inserts (no skip/dup) ------------------
  const before = listChatSummariesPage({ limit: 3 });
  const firstIds = before.items.map((c) => c.id);
  // Two brand-new chats (newest first) land ABOVE the cursor.
  createChat("chat-new-1", []);
  createChat("chat-new-2", []);
  const after = listChatSummariesPage({
    limit: 3,
    cursor: before.nextCursor ?? undefined,
  });
  const seenAfter = new Set([...firstIds, ...after.items.map((c) => c.id)]);
  assert(
    seenAfter.size === firstIds.length + after.items.length,
    "chats: insert above cursor → no duplicates, no skips",
  );

  // --- employees: assistant excluded + LIKE + keyset -------------------------
  db.prepare(
    "INSERT INTO employees (id, name, role, system_prompt, mcp, skills, model_id, avatar) VALUES (?, ?, ?, '', '[]', '[]', NULL, NULL)",
  ).run(1, "worker-one", "researcher");
  db.prepare(
    "INSERT INTO employees (id, name, role, system_prompt, mcp, skills, model_id, avatar) VALUES (?, ?, ?, '', '[]', '[]', NULL, NULL)",
  ).run(2, "worker-two", "writer");
  const empPage = listEmployeesPage({ limit: 1 });
  assert(
    empPage.items.length === 1 && empPage.hasMore,
    "employees: page 1 + hasMore",
  );
  const empPage2 = listEmployeesPage({
    limit: 1,
    cursor: empPage.nextCursor ?? undefined,
  });
  assert(
    empPage2.items[0]?.id === 2 && !empPage2.hasMore,
    "employees: keyset page 2, no dup",
  );
  assert(
    listEmployeesPage({ limit: 10, query: "worker" }).items.length === 2,
    "employees: LIKE name search works",
  );
  assert(
    listEmployeesPage({ limit: 10, query: "writer" }).items.length === 1,
    "employees: LIKE role search works",
  );

  // --- mcp: LIKE + keyset ----------------------------------------------------
  db.prepare(
    "INSERT INTO mcp_servers (id, name, description, transport, config) VALUES (?, ?, ?, 'stdio', '{}')",
  ).run(1, "server-a", "alpha tool");
  db.prepare(
    "INSERT INTO mcp_servers (id, name, description, transport, config) VALUES (?, ?, ?, 'stdio', '{}')",
  ).run(2, "server-b", "beta tool");
  assert(listMcpServersPage({ limit: 1 }).items.length === 1, "mcp: page 1");
  assert(
    listMcpServersPage({ limit: 10, query: "beta" }).items[0]?.id === 2,
    "mcp: description search",
  );

  // --- skills: in-memory page ------------------------------------------------
  const skillsDir = getAgentSkillsDir();
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(join(skillsDir, "skill-a"), { recursive: true });
  writeFileSync(
    join(skillsDir, "skill-a", "SKILL.md"),
    "---\ndescription: first skill\n---\n",
  );
  mkdirSync(join(skillsDir, "skill-b"), { recursive: true });
  writeFileSync(
    join(skillsDir, "skill-b", "SKILL.md"),
    "---\ndescription: second skill\n---\n",
  );
  const skillPage = await listSkillsPage({ limit: 1 });
  assert(
    skillPage.items[0]?.name === "skill-a" && skillPage.hasMore,
    "skills: sorted page 1",
  );
  const skillPage2 = await listSkillsPage({
    limit: 1,
    cursor: skillPage.nextCursor ?? undefined,
  });
  assert(
    skillPage2.items[0]?.name === "skill-b" && !skillPage2.hasMore,
    "skills: keyset page 2",
  );
  assert(
    (await listSkillsPage({ limit: 10, query: "second" })).items.length === 1,
    "skills: description search",
  );

  // --- skills: bulk import (frontmatter name + best-effort skip) ------------
  const srcRoot = mkdtempSync(join(tmpdir(), "imboss-skill-src-"));
  try {
    const good = join(srcRoot, "good-folder");
    mkdirSync(join(good, "sub"), { recursive: true });
    writeFileSync(
      join(good, "SKILL.md"),
      "---\nname: skill-c\ndescription: third skill\n---\n",
    );

    const noName = join(srcRoot, "no-name");
    mkdirSync(noName, { recursive: true });
    writeFileSync(
      join(noName, "SKILL.md"),
      "---\ndescription: missing name field\n---\n",
    );

    const noSkill = join(srcRoot, "no-skill");
    mkdirSync(noSkill, { recursive: true });
    writeFileSync(join(noSkill, "README.md"), "not a skill\n");

    const imported = await installSkillsFromFolders([good, noName, noSkill]);
    assert(
      JSON.stringify(imported) === JSON.stringify(["skill-c"]),
      `skills: bulk import uses frontmatter name & skips invalid (got ${JSON.stringify(imported)})`,
    );
    assert(
      existsSync(join(getAgentSkillsDir(), "skill-c", "SKILL.md")),
      "skills: imported skill-c lands under its frontmatter name",
    );
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }

  // --- providers: in-memory page ----------------------------------------------
  const authPath = getAuthPath();
  const modelsPath = getModelsPath();
  writeFileSync(
    authPath,
    JSON.stringify({ anthropic: { type: "api_key", key: "sk-test-12345" } }),
  );
  writeFileSync(
    modelsPath,
    JSON.stringify({
      providers: {
        "acme-llm": {
          baseUrl: "https://api.acme.example/v1",
          api: "openai-completions",
          models: [
            {
              id: "acme-1",
              name: "acme-1",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        },
      },
    }),
  );
  const provPage = await listProvidersPage({ limit: 2 });
  assert(
    provPage.items[0]?.id === "acme-llm" && provPage.hasMore,
    "providers: id-ASC order + hasMore",
  );
  const provPage2 = await listProvidersPage({
    limit: 2,
    cursor: provPage.nextCursor ?? undefined,
  });
  assert(
    JSON.stringify(provPage2.items.map((p) => p.id)) ===
      JSON.stringify(["deepseek", "google"]) && provPage2.hasMore,
    "providers: keyset page 2 (no dup, sorted)",
  );
  assert(
    (await listProvidersPage({ limit: 10, query: "acme" })).items.length === 1,
    "providers: id search",
  );

  if (failures === 0) {
    console.log("\nALL PAGING SMOKE CHECKS PASSED");
  } else {
    console.error(`\n${failures} CHECK(S) FAILED`);
    process.exitCode = 1;
  }
}

void main();
