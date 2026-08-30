# orca-imboss

An Electron desktop application for running an **AI agent as your "one man company"**, with a chat-based (WeChat–style) interface. You chat with your **assistant**, who coordinates **employees** (sub-agents) to complete work, collects feedback, and reports progress back to you.

> **Status:** Data folder (`~/.imboss`), full SQLite schema, and the prototype UI are implemented (chat/employees/models/MCP/skills/settings modules). Core agent interaction (chat + agent) is still stubbed (placeholder replies). See [Deferred / TODO](#deferred--todo).

---

## Highlights

- **Chat-first experience** — interact by chatting, like a desktop messaging app (WeChat-style design tokens, light/dark/system theme + 12 accent colors).
- **Single window, single instance** — one instance, one window, always.
- **Multi-language** — English (default) + Simplified Chinese (`zh-CN`). Language defaults to the system locale and can be changed in settings (stored in the database).
- **SQLite data layer** (`better-sqlite3`) — WAL mode: concurrent reads, serial writes.
- **Agent via the Pi SDK** — embedded, isolated environment that never touches your system Pi agent.
- **Automatic updates** — `electron-updater` against GitHub; multi-platform packaging via GitHub Actions.

---

## Architecture

The app follows the standard Electron process model, with the **data layer and agent living only in the main process** for security and native-module support.

```
┌────────────────────────── Renderer (React) ──────────────────────────┐
│  App shell (nav 208px | list 300px | detail 1fr)                     │
│  modules: chat · employees · models · mcp · skills · settings        │
└───────────────▲───────────────────────────────────▲──────────────────┘
        IPC │ (invoke / events)             IPC │ (invoke / events)
┌───────────────┴───────────────────────────────────┴──────────────────┐
│                        Preload (contextBridge)                       │
│             window.imb: locale, settings, agents, events             │
└───────────────┬───────────────────────────────────┬──────────────────┘
         invoke │                                   │ push events
┌───────────────┴───────────────────────────────────┴──────────────────┐
│                         Main process (Node)                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │  SQLite (WAL)    │  │  Pi Agent SDK    │  │  Update / Notify   │  │
│  │  SQLite schema   │  │  (~/.imboss)    │  │  electron-updater  │  │
│  └──────────────────┘  └──────────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

**Data flow**

- The **renderer never touches SQLite directly**; it goes through IPC.
- Data is read/written in the main process by services (`src/main/db/services/*`) and, in the future, by **Pi tools** that close over the same data layer.
- **Agent events** stream from the Pi session (in main) to the renderer over IPC.

---

## Tech stack

| Concern         | Choice                                                               |
| --------------- | -------------------------------------------------------------------- |
| Runtime         | Electron 44                                                          |
| Build           | `@desirecore/electron-vite` (Vite 7)                                 |
| UI              | React 19 + TypeScript (hand-written components + CSS, no UI library) |
| Package manager | pnpm                                                                 |
| Data layer      | `better-sqlite3` (WAL, synchronous, atomic writes)                   |
| Agent           | `@earendil-works/pi-coding-agent` (Pi SDK)                           |
| Localization    | `src/shared/libs/l10n.ts`                                            |
| Auto-update     | `electron-updater` + GitHub releases                                 |
| Packaging       | `electron-builder` (DMG / NSIS / AppImage)                           |

---

## Getting started

**Prerequisites**

- Node.js >= 22
- pnpm >= 9
- For native modules: build tools (Xcode CLT on macOS, MSVC on Windows, `build-essential` on Linux)

**Install & run**

```bash
pnpm install            # installs deps and rebuilds native modules for Electron
pnpm dev                # start electron-vite dev (with HMR)
```

**Scripts**

| Script            | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `pnpm dev`        | Run in development with HMR                        |
| `pnpm typecheck`  | Type-check main + renderer                         |
| `pnpm build`      | Type-check + build production bundles              |
| `pnpm start`      | Preview the built app                              |
| `pnpm format`     | Prettier format                                    |
| `pnpm dist:local` | Build + package for the current platform (`--dir`) |
| `pnpm dist:mac    | win                                                | linux` | Build + package for a specific platform |

---

## Localization (i18n)

- **English is the source of truth**: English text is passed directly to `t("...")`, so an English dictionary file is **not** required. When the active locale has no translation, `t()` returns the key (English) as-is.
- Only the **`zh-CN`** dictionary is shipped (`src/shared/translations/zhCN.json`), mapping English keys to Simplified Chinese.
- `src/shared/libs/l10n.ts` exposes `setupL10N(locale, translations)`, `t(key, args?, locale?)`, and `getLocale()`.

**Locale resolution order**

1. User preference stored in the DB (`settings` table, key `locale`), if set and supported.
2. Otherwise the system locale (`app.getLocale()`).
3. Otherwise English (`en`) fallback.

The resolved locale is injected into the renderer at startup (`--locale=...` via `additionalArguments`) and changed at runtime through the settings UI (`window.imb.setLocale(...)` → `locale:changed` IPC event).

**Theme**

- Mode (`light` / `dark` / `system`) persists in DB (`settings` key `theme.mode`) and drives Electron's `nativeTheme.themeSource`; Chromium's `prefers-color-scheme` follows it.
- Accent color persists in `settings` key `theme.color` (12 presets) and is injected as CSS variables by the renderer (`src/renderer/src/theme.ts`).

---

## Data layer

The app uses **`better-sqlite3`** with **WAL mode** (`journal_mode = WAL`) for concurrent reads while writes remain serialized. The database lives in the main process only, at **`~/.imboss/db/imboss.db`** — inside the app's dedicated data folder (see below).

- A lightweight migration runner (`src/main/db/migrations.ts`) tracks schema version via `PRAGMA user_version`. While unreleased, the schema is maintained directly in migration 0 (with a defensive "ensure columns" pass for dev-era databases).
- Tables:
  - **`settings`** — key/value store (locale, theme.mode, theme.color, defaultModel, env, ui.*).
  - **`employees`** — assistant + sub-agents; the built-in assistant always exists under reserved id `0`. Columns: `name`, `role`, `system_prompt`, `mcp` (JSON array of MCP server names), `skills` (JSON array), `model_id` (`provider/model`), `avatar` (stored file path).
  - **`chats`** — title, participants (JSON array), `unread` count.
  - **`messages`** — per-chat rows ordered by `pos`; `kind` (`text` | `task_progress`), `steps` (JSON progress steps), `attachments` (JSON metadata).
  - **`sessions`** — Pi session path per employee per chat.
  - **`mcp_servers`** — MCP server configs: `transport` (`stdio` | `sse` | `streamable-http`) + transport-specific `config` JSON.

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- employees / chats / messages / sessions / mcp_servers — see src/main/db/migrations.ts
```

---

## Agent (Pi SDK)

The agent is powered by the **Pi SDK** (`@earendil-works/pi-coding-agent`) and runs **in the main process**.

- The app maintains its **own** Pi environment under **`~/.imboss/agent`** (`src/main/agent/environment.ts`): `auth.json` (provider API keys, 0600), `models.json` (custom providers/models), `skills/` and `sessions/` — so it **never touches your system Pi agent** (`~/.pi/agent`).
- **Model providers** are managed in the models module (curated list or custom base URL + API key); configuration files are the source of truth, exclusively managed in the main process. API keys are masked in the UI (last 4 chars) and only revealed on explicit user action.
- **Skills** can be imported from a local folder (`SKILL.md` is the source of truth) and uninstalled from the skills module; the UI is read-only for skill metadata.
- **MCP servers** are bridged app-side (`src/main/agent/mcp.ts`): Pi has no native MCP, so stdio / sse / streamable-http servers are connected by the main process and their tools are surfaced to the Pi session as custom tools. stdio servers are spawned with `{ ...process.env, ...userEnv, ...serverEnv }`.
- **User env vars** (Settings → General → “Environment variables”) reach every subprocess: the bash / PowerShell tools inject them via `spawnHook`, and stdio MCP servers get the merged env. Values support `$VAR` / `${VAR}` expansion against the app's own environment; precedence is process env → user env → per-server env.

> **Current state:** `chat:send` runs a real per-message Pi session (`createAgentSession`) with the env-aware tools + the assistant's MCP servers, and persists the final assistant reply. Streaming events to the renderer and persistent per-chat sessions are still deferred.

---

## Build & packaging targets

| Platform | Target                                  |
| -------- | --------------------------------------- |
| macOS    | DMG (+ a companion ZIP for auto-update) |
| Windows  | NSIS installer                          |
| Linux    | AppImage                                |

Packaging is configured in `electron-builder.yml`.

---

## Release & auto-update

- **GitHub Actions** (`.github/workflows/release.yml`) builds and publishes on a `v*` tag across macOS / Ubuntu / Windows to a **GitHub release**.
- **`electron-updater`** (`src/main/updater/index.ts`) checks **GitHub** for updates. It runs only in the packaged app.

**To publish a release:**

1. Push a tag, e.g. `git tag v0.1.0 && git push --tags`.
2. The workflow will run (`pnpm build` + `electron-builder --publish always`).
3. Ensure the GitHub `GH_TOKEN` secret is configured in the repository settings.

---

## Project structure

```
src/
├── main/
│   ├── agent/          # Pi environment management
│   │   ├── environment.ts  # agentDir root (~/.imboss/agent)
│   │   ├── providers.ts    # auth.json / models.json owner (source of truth)
│   │   ├── skills.ts       # skills install/uninstall
│   │   ├── session.ts      # Pi session orchestration (stubbed)
│   │   └── tools.ts        # defineAgentTools (stubbed)
│   ├── avatars.ts        # ~/.imboss/avatars/<id>.<ext> store (data URLs via service)
│   ├── data-dir.ts       # ~/.imboss path resolution + layout + hardening
│   ├── db/
│   │   ├── index.ts          # SQLite connection + WAL + FK + init
│   │   ├── migrations.ts     # user_version migration runner (schema in migration 0)
│   │   └── services/         # settings, employees, chats, messages, sessions, mcp
│   ├── ipc/index.ts          # renderer ↔ main channels (mcp/chat/theme/avatar + CRUD)
│   ├── theme.ts              # nativeTheme.themeSource + DB persistence + broadcast
│   ├── notifications/        # OS notifications (stubbed)
│   ├── updater/              # electron-updater wiring
│   ├── index.ts              # app entry (window, single-instance, wiring)
│   └── locale.ts             # locale resolution
├── preload/
│   ├── index.ts              # contextBridge API
│   └── index.d.ts            # window.imb typings
├── renderer/
│   ├── index.html
│   └── src/
│       ├── App.tsx           # app shell + module switching
│       ├── app-store.ts      # global app state (valtio): module/locale/theme/nav
│       ├── theme.ts          # 12 accent presets + CSS variable injection
│       ├── main.tsx
│       ├── styles/           # tokens.css (design tokens), base.css (reset)
│       └── components/       # one folder per component (index.tsx + index.css)
│           ├── button, select, multi-select, modal, avatar, …
│           ├── app-shell, nav, list-pane, detail-pane, context-menu…
│           └── modules/      # chat, employees, models, mcp, skills, settings
└── shared/
    ├── libs/l10n.ts          # t() / setupL10N()
    ├── constants.ts          # locales, normalization
    ├── types.ts              # shared types (employees/chats/messages/mcp/theme/…)
    └── translations/zhCN.json
```

## Data folder (~/.imboss)

All app data lives in a dedicated folder under the user's home directory:

```
~/.imboss/
├── db/imboss.db          # SQLite (WAL) — settings/employees/chats/messages/sessions/mcp_servers
├── avatars/              # employee avatar files <id>.<ext> (0600)
└── agent/                # isolated Pi environment (agentDir)
    ├── auth.json         # provider API keys (0600)
    ├── models.json       # custom providers & models
    ├── skills/<name>/SKILL.md
    └── sessions/         # Pi session files (used once runtime wiring lands)
```

---

## Deferred / TODO

These areas are scoped for upcoming iterations and are intentionally left as stubs or extension points:

- **Live Pi agent integration** — `createAgentSession` is wired per user message (env-aware shell tools + app-side MCP bridge, final reply persisted); remaining: streaming events over IPC, per-chat session persistence (`SessionManager.create` via the `sessions` table), group-chat session orchestration.
- **Progress messages** — `task_progress` kind is renderable from DB rows; nothing generates `steps` yet (placeholder pipeline only).
- **Mini Apps (世界地图) and 产品网站改版** — nav entries exist as "暂未开放" placeholder pages.
- **Notification rules** — which events trigger OS notifications in the background.
- **Auto-update UI feedback** — progress + install prompts over IPC.

---

## Notes

- Native modules (`better-sqlite3`) are rebuilt for the Electron ABI via `postinstall` (`electron-builder install-app-deps`).
- The CSP in `src/renderer/index.html` is intentionally strict (inline styles allowed for the theme accent injection).
- Follow the project conventions in `AGENTS.md` when contributing.
