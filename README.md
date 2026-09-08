# orca-imboss

An Electron desktop application for running an **AI agent as your "one man company"**, with a chat-based (WeChat–style) interface. You chat with your **assistant**, who coordinates **employees** (sub-agents) to complete work, collects feedback, and reports progress back to you.

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
│             imb: locale, settings, agents, events                    │
└───────────────┬───────────────────────────────────┬──────────────────┘
         invoke │                                   │ push events
┌───────────────┴───────────────────────────────────┴──────────────────┐
│                         Main process (Node)                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │  SQLite (WAL)    │  │  Pi Agent SDK    │  │  Update / Notify   │  │
│  │  SQLite schema   │  │  (~/.imboss)     │  │  electron-updater  │  │
│  └──────────────────┘  └──────────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

**Data flow**

- The **renderer never touches SQLite directly**; it goes through IPC.
- Data is read/written in the main process by services (`src/main/db/*`) and, in the future, by **Pi tools** that close over the same data layer.
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
| Localization    | `src/shared/l10n.ts`                                                 |
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

---

## Localization (i18n)

- **English is the source of truth**: English text is passed directly to `t("...")`, so an English dictionary file is **not** required. When the active locale has no translation, `t()` returns the key (English) as-is.
- Only the **`zh-CN`** dictionary is shipped (`src/shared/translations/zhCN.json`), mapping English keys to Simplified Chinese.
- `src/shared/l10n.ts` exposes `setupL10N(locale, translations)`, `t(key, args?, locale?)`, and `getLocale()`.

---

## Data layer

The app uses **`better-sqlite3`** with **WAL mode** (`journal_mode = WAL`) for concurrent reads while writes remain serialized. The database lives in the main process only, at **`~/.imboss/db/imboss.db`** — inside the app's dedicated data folder (see below).

- A lightweight migration runner (`src/main/db/migrations.ts`) tracks schema version via `PRAGMA user_version`. While unreleased, the schema is maintained directly in migration 0 (with a defensive "ensure columns" pass for dev-era databases).

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

## Deferred / TODO

These areas are scoped for upcoming iterations and are intentionally left as stubs or extension points:

- **Progress messages** — `task_progress` kind is renderable from DB rows; nothing generates `steps` yet (placeholder pipeline only).
- **Mini Apps (世界地图) and 产品网站改版** — nav entries exist as "暂未开放" placeholder pages.
- **Notification rules** — which events trigger OS notifications in the background.
- **Auto-update UI feedback** — progress + install prompts over IPC.

---

## Notes

- Native modules (`better-sqlite3`) are rebuilt for the Electron ABI via `postinstall` (`electron-builder install-app-deps`).
- The CSP in `src/renderer/index.html` is intentionally strict (inline styles allowed for the theme accent injection).
