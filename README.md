[简体中文](README.zh.md) · [Website](https://orca-studio.com/imboss/)

# imboss

**Run a one-man company with AI employees — from a single chat window.**

imboss is a desktop app where you chat with an AI **Assistant** who acts as your chief of staff. Tell it what you need, and it assembles a team of AI **Employees**, hands out the work in group chats, keeps you posted on progress, and reports back with the result.

<img width="1938" height="1412" alt="imboss" src="https://github.com/user-attachments/assets/e785e2e1-145a-436b-a1e6-975710ffbd24" />

## Intro Video

[imboss intro video](https://www.bilibili.com/video/BV1e3po6rET6/?share_source=copy_web&vd_source=89506ada1738e6a7900dc6eb24d24da5)


## How it works

1. **You talk to the Assistant.** Chat naturally, like messaging a colleague — no prompt engineering required.
2. **The Assistant plans and staffs the job.** It breaks your request into tasks, checks who is already on the team, recruits specialists when the right expertise is missing, and opens a task group chat.
3. **Employees do the work.** Each employee has its own role, persona, model, tools, skills and MCP servers. They research, write, run commands and produce real deliverables.
4. **The team coordinates itself.** Employees @-mention each other, ask questions and report results, while the Assistant keeps the task moving and unblocks them.
5. **You stay in control.** Follow progress in the chat, answer questions when a decision is genuinely needed, and receive the finished result.

## Features

### Chat-first workspace

- A WeChat-style messaging UI: conversation list, message bubbles, avatars, unread badges and read state.
- Attachments (images and files), rich Markdown rendering with syntax highlighting and KaTeX math.
- Dedicated **ask cards** collect structured answers from you, while **progress cards** show the live step-by-step status of a task.
- One window, one instance — always.

### An Assistant that manages the team

- A built-in Assistant (the team's orchestrator) plots the plan, recruits employees, creates task chats, assigns work and reports to you.
- You can edit its persona and system prompt, and tune how it works, from the assistant's detail page.

### A team of employees

- **Recruit** specialists with a name, role and persona; pick an avatar and a system prompt that defines who they are and how they work.
- Give each employee their own **model** and **thinking level**, or let them follow the app default.
- Equip employees with **skills**, **MCP servers**, and optional **scheduled tasks**.
- Employees reply in the same language you use, and report their results back to whoever assigned the task.

### Task group chats

- The Assistant opens a **group chat** per task and @-mentions the employees who own each part.
- Group chats are readable from your chat list, showing the full back-and-forth between your employees.
- Questions, answers and reports flow through the same messaging model, so you can audit how any result was produced.

### Model providers

- Connect providers through a curated list (Anthropic, OpenAI, DeepSeek, Google, Groq, MiniMax, Moonshot AI, OpenRouter, OpenCode Zen, OpenCode Go, xAI, Xiaomi, Z.ai, GitHub Copilot, and more) or add a **custom** provider.
- Supports OpenAI-compatible completions/responses, Anthropic Messages and Google Generative AI APIs.
- Fetch available models with one click, and keep API keys masked behind an explicit reveal.

### MCP servers

- Register [Model Context Protocol](https://modelcontextprotocol.io) servers over **stdio** or **streamable HTTP**.
- Assign servers per employee, so each session only connects the tools it actually needs.
- Per-server environment variables, plus app-wide environment variables shared with tools and servers.

### Skills

- Install [Agent Skills](https://agentskills.io) from local folders (`SKILL.md` is the source of truth) and uninstall them when done.
- Choose exactly which skills each employee can use.
- The Assistant ships with built-in skills that let it manage MCP servers, manage skills and build mini apps on your behalf.

### Mini Apps

- Run local web apps directly in the sidebar next to your chats.
- A mini app is just a folder with a `metadata.json`; it can be a static page or a process you start (with command, args, cwd and env).
- Mini apps keep running while you move between modules, and the Assistant can create and debug them for you.

### Scheduled tasks

- Give an employee a cron schedule to wake it up automatically — e.g. a daily digest or a periodic check.
- See the next run time and toggle tasks on or off per employee.
- Tasks run while the app is open (in-process scheduler, not an OS service).

### Messaging integrations

- Bridge imboss to your real messaging apps so you can work from your phone:
  - **WeChat** via the official iLink Bot (QR-code login).
  - **QQ** via the official QQ Bot platform.
  - **Telegram** via a @BotFather bot.
- Owner accounts are whitelisted: messages you send are treated as yours, and the Assistant's replies are delivered back to that conversation.
- Inbound images and files are imported into the chat; outbound messages are forwarded natively.

### Notifications

- Native desktop notifications when an agent posts while the window is in the background — click to jump straight to the chat.
- Unread counters and a notification sound keep you aware of new activity.

### Appearance and language

- Light, dark and system themes with **18 accent colors**.
- English and Simplified Chinese, defaulting to your system locale.

### Private and local by design

- Everything lives in a single folder in your home directory: **`~/.imboss`** — database, avatars, agent environment, sessions and mini apps.
- imboss manages its own isolated Pi agent environment, so it never touches a system-wide Pi installation.
- API keys are stored locally with restrictive file permissions.

### Automatic updates

- Built-in updates from GitHub releases: get notified, download and restart to apply.

## Getting started

**Prerequisites**

- Node.js >= 22
- pnpm >= 9
- Build tools for native modules (Xcode CLT on macOS, MSVC on Windows, `build-essential` on Linux)

**Install and run**

```bash
pnpm install            # install deps and rebuild native modules for Electron
pnpm dev                # start the app with hot reload
```

On first launch, add a model provider in **Providers**, then say hello to your Assistant in **Chats**.

## Building

```bash
pnpm build              # typecheck + build
pnpm dist:mac           # macOS (DMG + ZIP)
pnpm dist:win           # Windows (NSIS installer)
pnpm dist:linux         # Linux (AppImage)
```

## License

imboss is **dual-licensed**:

- **Open source — GPL-3.0.** Free for personal use. The full text is in [LICENSE](LICENSE).
- **Commercial license.** Required for **any use by or within an enterprise, including purely internal use**. See [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md) and contact [kefroth@outlook.com](mailto:kefroth@outlook.com) for details.

If you use imboss under GPL-3.0 you must comply with all of its terms, including making your derivative work available under the same license. Note that GPL-3.0 compliance alone does **not** grant enterprise use: any use by or within an enterprise requires a commercial license. If you cannot or do not want to comply with GPL-3.0, or if you need enterprise use, a commercial license is required.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Contributor License Agreement](CLA.md).

## Under the hood

- **Runtime** — Electron 44, React 19 + TypeScript, `electron-vite`.
- **Data** — `better-sqlite3` in WAL mode, kept in the main process behind IPC.
- **Agent** — the [Pi SDK](https://github.com/earendil-works/pi-coding-agent), isolated under `~/.imboss/agent`.
- **Updates & packaging** — `electron-updater` and `electron-builder`.

## Buy me a coffee

If you think the software I have developed is helpful to you and would like to give recognition and support, you may buy me a coffee using following link. Thank you for your support and attention.

<a href='https://ko-fi.com/R5R213X8MC' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi1.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>
