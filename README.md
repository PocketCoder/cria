# Cria

A native desktop and iOS client for [Vikunja](https://vikunja.io) — an offline-first task manager built with Tauri 2 and React.

## Features

- **Cross-platform**: desktop (macOS, Windows, Linux) and **iOS** from one codebase — a responsive layout collapses the three panes to a single navigable view on iPhone, with touch (pointer) drag-and-drop
- **Three-pane layout**: projects sidebar | task list | detail pane with editable fields
- **Offline-first**: local SQLite database, syncs in the background
- **Rich task editing**: WYSIWYG description (TipTap), inline metadata pickers for priority, dates, labels, assignees, color, repeat, and more
- **Global quick-add**: `Cmd+Shift+A` to create tasks with natural language parsing
- **Reminders**: native notifications — desktop fires them while running; iOS schedules them with the OS so they arrive even when the app is closed
- **Native OS integration** (desktop): tray icon, global shortcuts, deep links (`vikunja://`), autostart, Dock badge — gated off on iOS, which provides its own equivalents
- **Conflict resolution**: detected and surfaced when local changes conflict with server updates
- **Sync engine**: exponential-backoff outbox drain, dead-letter queue for persistent failures

## Stack

| Layer | Choice |
|---|---|
| Shell | [Tauri 2](https://v2.tauri.app) (Rust) — desktop + iOS |
| Frontend | React 18 + TypeScript + Vite |
| State | TanStack Query (server cache) + Zustand (UI state) |
| Local DB | SQLite via `@tauri-apps/plugin-sql` |
| API client | `openapi-fetch` + generated types from Vikunja OpenAPI spec |
| Styling | Tailwind CSS v4 + Radix UI primitives |
| Validation | Zod |

## Prerequisites

- **Node.js** >= 20 (with `pnpm` installed)
- **Rust toolchain** via [rustup](https://rustup.rs)
- **Tauri system dependencies** — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- **For iOS** (macOS only): Xcode + Command Line Tools, [CocoaPods](https://cocoapods.org), the iOS Rust target (`rustup target add aarch64-apple-ios`), and an Apple Developer account — a free personal team works for on-device testing (builds expire after 7 days)

## Development

```sh
# Install dependencies
pnpm install

# Start the full Tauri dev environment
pnpm dev

# Frontend-only dev (no Tauri webview)
pnpm vite

# Type-check
pnpm typecheck

# Run tests
pnpm test

# Production frontend build
pnpm vite:build
```

### iOS

```sh
# Run on a connected device / simulator (dev server + hot reload).
# --host serves Vite on the LAN so a physical device can reach it.
pnpm tauri ios dev --host

# Standalone release build — bundles the frontend, runs with no Mac attached.
# `debugging` export = development signing, for your own registered device.
pnpm tauri ios build --export-method debugging
```

The Xcode project lives under `src-tauri/gen/apple/` (regenerate with `pnpm tauri ios init`). A debug iOS build needs ~10 GB of free disk. CI compile-checks the iOS shell on every native-code change ([`.github/workflows/ci-ios.yml`](.github/workflows/ci-ios.yml)); signed iOS distribution is currently a manual step (needs a paid Apple account).

### Regenerating API types

```sh
VK_URL=https://your-vikunja-instance pnpm generate:api
```

Defaults to `https://try.vikunja.io` when `VK_URL` is not set.

## Architecture

```
UI (React) → TanStack Query → Local SQLite ← Sync Engine → Vikunja REST API
                    ↑                              │
                    └── Zustand (UI state)          │
                                                   ▼
                                            Outbox table
```

- UI reads exclusively from the local DB — always instant, works offline.
- Writes go to the local DB first, then enqueue an outbox row.
- The sync engine drains the outbox FIFO against the Vikunja API with exponential backoff.
- Sync-path upserts never invalidate queries mid-pull (avoids infinite refetch loops).

## Project structure

```
src/
├── api/          # Generated API types + openapi-fetch client
├── auth/         # Auth store, credential storage
├── components/   # Shared UI components
├── db/           # SQLite repositories + schema migrations + bus
├── domain/       # Domain types + Zod schemas
├── features/     # Feature modules (projects, tasks, task-detail, shell)
├── lib/          # Utility helpers
├── queries/      # TanStack Query hooks
├── stores/       # Zustand stores
├── sync/         # Pull/push sync engine
├── tauri/        # Tauri plugin wrappers
└── utils/        # General utilities
```

## License

MIT
