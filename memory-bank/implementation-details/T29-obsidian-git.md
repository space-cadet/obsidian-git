# T29 Implementation: obsidian-git Plugin Architecture

*Created: 2026-05-31 13:45 IST*
*Task: T29*

## Overview

Obsidian plugin for git synchronization using `isomorphic-git` (pure JavaScript, no native git binary). Designed for desktop (Electron) and mobile (iOS/Android) Obsidian.

## Core Components

### 1. GitManager (`src/gitManager.ts`)

Wraps `isomorphic-git` operations. Centralized git control with error handling and logging.

**Constructor:**
```typescript
new GitManager(vaultPath: string, adapter: DataAdapter, logger: Logger, onAuth?: () => Promise<Auth>)
```

**Key methods:**
- `init()` — `git.init({ fs: this.fs, dir: this.vaultPath, defaultBranch: 'main' })`
- `clone()` — `git.clone({ url, dir, onAuth })` with single branch, no tags
- `add(filepath)` — `git.add({ fs, dir, filepath })`
- `commit(message)` — `git.commit({ fs, dir, message, author })` with `GitManager.AUTHOR` constant
- `push()` — `git.push({ fs, dir, remote, onAuth })` with force=true
- `pull()` — `git.pull({ fs, dir, remote, onAuth, fastForwardOnly: true })`
- `sync()` — `pull` → `add('*')` → `commit('sync: ...')` → `push`. Skips remote ops if `repoUrl` empty.
- `getDetailedStatus()` — returns `{ hasRepo, status, changes: { added, modified, deleted, untracked } }`
- `getChangedFiles()` — parses `statusMatrix` result, filters rows where WORKDIR or STAGE differs from HEAD
- `stageFile(filepath)` — `git.add({ fs, dir, filepath })`
- `unstageFile(filepath)` — `git.remove({ fs, dir, filepath })` (removes from index, keeps in working tree)
- `log()` — `git.log({ fs, dir, depth: 50 })`

**Error handling:**
- All methods catch errors, log with `[GitManager]` prefix, throw for UI to display
- `getDetailedStatus()` returns `{ hasRepo: false, ... }` on error rather than crashing
- `sync()` catches push/pull errors but continues with local commit

### 2. ObsidianFsAdapter (`src/adapters/ObsidianFsAdapter.ts`)

Custom filesystem adapter for `isomorphic-git`. Implements the `fs` interface expected by isomorphic-git.

**Interface:**
```typescript
interface FsAdapter {
  readFile(path: string, opts?: { encoding?: string }): Promise<Buffer | string>
  writeFile(path: string, data: Buffer | string, opts?: { encoding?: string, mode?: number }): Promise<void>
  readdir(path: string): Promise<string[]>
  stat(path: string): Promise<{ type: 'file' | 'directory', size: number, mtimeMs: number }>
  mkdir(path: string, opts?: { recursive?: boolean, mode?: number }): Promise<void>
  rmdir(path: string): Promise<void>
}
```

**Implementation details:**
- `readFile(path, opts)`:
  - Binary read: `adapter.readBinary(path)` → returns `ArrayBuffer` → `Buffer.from(arrayBuffer)`
  - Text read: `adapter.read(path)` → returns `string`
  - **CRITICAL FIX**: For `.git/objects/pack/*.idx` files, `readBinary()` returns `null` on desktop. Falls back to Node.js `fs` via `window.require('fs')` on Electron desktop.
  - Desktop detection: `typeof window !== 'undefined' && (window as any).require && (window as any).process` (checks for Electron renderer process)
- `writeFile(path, data, opts)`:
  - Binary: `adapter.writeBinary(path, new Uint8Array(buffer))`
  - Text: `adapter.write(path, data)`
- `readdir(path)` — `adapter.list(path)` returns array of strings
- `stat(path)` — constructs from `adapter.list(path)` (presence check) + `adapter.read(path)` for size
- `mkdir(path)` — `adapter.mkdir(path)`
- `rmdir(path)` — `adapter.rmdir(path, true)` (recursive)

**Pack Index Problem:**
- Obsidian's `DataAdapter.readBinary()` returns `null` for `.git/objects/pack/*.idx` files (pack index files)
- This causes `BufferCursor.slice` to fail with "Cannot read properties of null (reading 'slice')"
- Root cause: isomorphic-git's `FileSystem.read` catches all errors and returns null (known bug)
- **Desktop fix**: `window.require('fs')` direct read via `fs.promises.readFile(path)` → returns `Buffer`
- **Mobile fix**: Not yet implemented. Options: LightningFS, wasm-git, or use a different git library

**Path resolution:**
- `vaultPath` defaults to `'.'` (not `''`) — `findRoot` fails with empty string
- `dir: this.vaultPath` passed to all isomorphic-git operations
- For `window.require` fallback: constructs absolute path via `adapter.getBasePath() + '/' + path`

### 3. GitSidebarView (`src/views/GitSidebarView.ts`)

Three-tab sidebar view for Obsidian's right sidebar.

#### Approved sidebar interaction model (2026-08-18)

- Changes is the only tab with the bottom action bar. It contains `Commit
  (N)`, `Pull`, `Push`, and `More`.
- The commit message is entered in a modal opened by `Commit (N)`.
- `.gitignore` editing, ignored-pattern management, and force push are in the
  Changes tab's `More` menu.
- Each changed file keeps its stage/unstage button visible. Ignore and other
  secondary actions are in a per-file `…` menu.
- Commits and Log hide the Changes action bar so their lists can use the full
  sidebar height.
- Refresh is in the branch header and therefore remains available regardless
  of the selected tab.
- Log actions are grouped under `More`: export, clear, and copy details.

The approved visual references are stored at:

- `memory-bank/assets/ui-mockups/sidebar-changes-approved.png`
- `memory-bank/assets/ui-mockups/sidebar-commits-approved.png`
- `memory-bank/assets/ui-mockups/sidebar-log-approved.png`

The interaction contract above remains valid. The visual redesign and
visual-acceptance plan are now tracked separately in
`implementation-details/sidebar-ui-redesign.md` under T29a so this document
continues to distinguish behavior from presentation.

**View type:** `VIEW_TYPE_GIT_SIDEBAR = 'git-sidebar-view'`

**Tabs:**
1. **Changes** — Shows modified/untracked files. Each file has stage/unstage toggle, diff preview. Staging area for commit.
2. **History** — Shows commit history with message, author, date. Click to see diff.
3. **Git Log** — Raw git log output with branch visualization.

**Header:**
- Repo status indicator (green dot = synced, yellow = uncommitted, red = no repo)
- Settings gear icon → opens `GitSettingTab`
- Initialize button (when no repo detected)
- Refresh button (manual refresh)

**States:**
- **Has repo**: Shows three tabs, file list, action buttons (stage all, commit, sync, pull, push)
- **No repo**: Shows "No git repository" message with Initialize button
- **Error**: Shows error card with retry button and detailed error message

**Auto-refresh:**
- `updateRefreshInterval(interval: number)` — sets/clears `setInterval` for status refresh
- Interval configurable in settings (seconds, 0 = disabled)
- Clears previous interval before setting new one

**Mobile responsiveness:**
- Horizontal scroll on ActionBar (overflow-x: auto, scrollbar-width: none)
- Wider message bubbles
- Auto-expand textarea in ChatInput
- Always-visible message actions

### 4. GitSettingTab (`src/main.ts` — inner class)

Obsidian plugin settings UI. Accessible via:
- Settings → Community Plugins → Git Sync → Options
- Gear icon in sidebar header

**Fields:**
1. **Remote Repository URL** — GitHub repo URL (e.g., `https://github.com/user/repo`)
2. **Branch** — Default branch name (default: `main`)
3. **Author Name** — Git commit author name
4. **Author Email** — Git commit author email
5. **Username** — Git auth username (for GitHub, any value works with PAT)
6. **Password / Personal Access Token** — Git auth password or PAT. Help text: "For GitHub, use a Personal Access Token (PAT). Fine-grained PATs work with any username."
7. **Auto-sync Interval** — Seconds between auto-sync (0 = disabled)

**Test Connection button:**
- Validates credentials by attempting a git operation
- Shows success/error notice

### 5. Logger (`src/logger.ts`)

Structured logging with context prefix.

```typescript
class Logger {
  prefix: string
  log(...args: any[]): void
  error(...args: any[]): void
}
```

Usage: `new Logger('GitManager')` → logs `[Git Sync][GitManager] message`

## State Flow

### Initialization Flow
```
Plugin.onload()
  → GitSyncPlugin.onLoad()
    → registerView(VIEW_TYPE_GIT_SIDEBAR, GitSidebarView)
    → addCommand('git-sync:sync') → this.sync()
    → addCommand('git-sync:open-sidebar') → revealSidebar()

Sidebar opens
  → GitSidebarView.onOpen()
    → this.plugin.ensureGitManager() (lazy init)
    → refresh() → detectRealGitRepo() → renderStatusTab()
    → no clone/init side effect

ensureGitManager()
  → if (!gitManager) create new GitManager(vaultPath, adapter, logger, onAuth)
  → GitManager constructor creates ObsidianFsAdapter
```

### Sync Flow
```
User clicks Sync / Auto-sync fires (only when a local repo exists)
  → GitManager.sync()
    → require existing local repository
    → if (repoUrl) git.pull()
    → git.add('*')
    → git.commit('sync: ...')
    → if (repoUrl) git.push()
  → GitSidebarView.refresh() (update UI)

User clicks Clone Remote
  → syncVault(true)
    → GitManager.initializeRepo()
    → clone or verified-empty-remote initialization
```

### Status Detection Flow
```
renderStatusTab()
  → plugin.detectRealGitRepo() (check .git/HEAD exists)
  → if (!hasRepo) renderUninit()
  → gitManager.getDetailedStatus()
    → git.statusMatrix() → parse rows
    → return { hasRepo, status, changes }
  → render file list with stage/unstage toggles
```

## Auth Flow

```
GitManager.onAuth()
  → read settings (username, password/PAT)
  → return { username, password }
  → isomorphic-git passes this to git HTTP basic auth

GitHub fine-grained PAT:
  - username: any string (e.g., 'token', 'x-access-token', user's name)
  - password: the PAT (e.g., 'github_pat_11A...')
  - GitHub accepts any username for PAT-based basic auth
```

## CSS Architecture

**File**: `styles.css`

**Key classes:**
- `.git-sidebar` — Root container
- `.git-sidebar-header` — Title + status + action buttons
- `.git-sidebar-tabs` — Tab navigation
- `.git-sidebar-tab` — Individual tab content
- `.git-sidebar-uninit` — No-repo state container
- `.git-sidebar-error` — Error card
- `.git-sidebar-action-bar` — Horizontal scroll action buttons
- `.git-sidebar-settings-btn` — Gear icon button
- `.zen-mode` — Hides chrome, minimal UI

**Mobile:**
- `@media (max-width: 768px)` — Wider bubbles, horizontal scroll, compact buttons
- `scrollbar-width: none` (Firefox) + `::-webkit-scrollbar { display: none }` (WebKit)

## Build System

**esbuild.config.mjs:**
- Entry: `src/main.ts`
- Output: `main.js` (bundled for Obsidian)
- External: `obsidian` (provided by Obsidian runtime)
- Format: IIFE
- Production: `NODE_ENV=production`

**TypeScript:**
- Target: ES2020
- Strict mode enabled
- `skipLibCheck: true` (for isomorphic-git type compatibility)

## Testing Checklist

- [x] Plugin loads in Obsidian
- [x] Sidebar opens with three tabs
- [x] Settings tab opens from gear icon
- [x] Refresh interval configurable (0 = disabled)
- [x] Initialize button creates new repo
- [ ] Pack index fix works on desktop (v9 pending test)
- [ ] Mobile shows correct "No repo" message (v9 pending test)
- [ ] Mobile Initialize button works (v9 pending test)
- [ ] Push/pull with GitHub PAT works
- [ ] Auto-sync interval fires correctly
- [ ] Stage/unstage individual files
- [ ] Commit with custom message
- [ ] Git log displays correctly
- [ ] Mobile responsive layout
- [ ] GitHub release automation

## References

- isomorphic-git docs: https://isomorphic-git.org/
- Obsidian API docs: https://docs.obsidian.md/
- GitHub PAT docs: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token
- Pack index issue: https://github.com/isomorphic-git/isomorphic-git/issues/XXXX (TBD)

## Auto-Updater and Release Artifacts (2026-08-10)

### Runtime updater

`src/updater/PluginUpdater.ts` checks `space-cadet/obsidian-git` through
Obsidian's native `requestUrl` API and writes release assets through the vault
adapter. Stable checks use the latest GitHub release; dev checks select the
rolling `dev` pre-release. The settings UI supports daily startup checks,
manual checks, stable auto-install, and confirmation before dev installation.

The build embeds the full Git commit hash through `esbuild.config.mjs` and
`src/buildInfo.ts`. Dev checks compare the local hash with `main` HEAD because
the rolling dev manifest can remain at version `1.0.0`; version-only comparison
would otherwise report a perpetual update.

Installation backs up `main.js`, `manifest.json`, and `styles.css` under the
plugin's `.backup` directory. A partial write restores the pre-install files,
and a persisted backup can be restored through `PluginUpdater.rollback()`.
The updater validates that the downloaded manifest belongs to the installed
plugin before installation.

### Release workflow and local archive

`.github/workflows/build-release.yml` builds before both stable and dev release
jobs and publishes the ZIP plus direct `main.js`, `manifest.json`, and
`styles.css` assets. Direct assets are required for mobile-safe installation;
the runtime does not depend on Node ZIP extraction.

`pnpm run archive` creates the versioned ZIP and copies the unpacked package
files (`main.js`, `manifest.json`, `versions.json`, `styles.css`, and
`README.md`) directly into `dist/`. `tests/archive.test.mjs` verifies both the
ZIP listing and the unpacked files, while `tests/updater.test.mjs` covers
channel selection, commit matching, asset validation, plugin identity, and
transactional rollback.

### Verification and remaining gate

Production build, 13 Node tests, 10 isomorphic-git smoke checks, archive
validation, and `git diff --check` pass. Real Android/iOS acceptance remains
open, and the v1.0.0 tag remains approval-gated until authentication and
mobile release checks are complete.

## Architecture Review Follow-up (2026-08-11)

The original architecture remains the historical description of the current
implementation. Cross-cutting hardening is now tracked separately under T35:

- T35a: credential safety and Git staging boundaries
- T35b: operation coordination and lifecycle safety
- T35c: repository initialization and destructive-operation safety
- T35d: mobile and remote transport reliability

## Staging Performance and Ignore Enforcement — 2026-09-03

- Tracked deletions are staged through `git.remove()` so missing worktree files
  do not cause `NotFoundError` failures.
- Bulk staging uses bounded batches of 64 with parallel filepath processing and
  per-file fallback. Mobile-sensitive fingerprint reads use bounded concurrency.
- The implementation still needs a central `.gitignore` enforcement check for
  caller-supplied staging paths. Plugin-owned-path exclusion is a separate
  security boundary and cannot replace Git ignore semantics.
- `unstageAll()` and other single-file mutation paths remain candidates for
  batching or a future isomorphic-git API extension.
- T35e: updater integrity and release artifact consistency
- T35f: test, CI, and documentation alignment

T29 remains the release-package and acceptance owner; T34 remains the
authentication owner. The new `security-and-secrets.md` and
`reliability-and-lifecycle.md` documents hold the durable design boundaries
that should guide implementation.

## Maintenance and Diagnostics Settings — 2026-09-03

The Settings panel now includes a Maintenance section with repository health,
HEAD-based local index repair, repair backup/restore, and remote comparison
preview actions. Dry-run output is retained in the panel and can be selected
and copied as text.

Diagnostics include persisted plugin-scoped file logging, memory/DOM metrics,
updater adapter tracing, and lifecycle records for maintenance actions. The
file logger owns its sink instead of globally intercepting console output, so
messages from Dataview, ObsidianAI, and other plugins are excluded.

Index repair is an index-only operation. Protected remote reconstruction,
replacement, and rollback for an existing damaged repository remain separate
T35c work. Mobile testing still has an unresolved existing-repository ref
failure for `refs/heads/main`.
