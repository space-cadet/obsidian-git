# Edit History

*Created: 2026-05-28 20:16:00 IST*
*Last Updated: 2026-08-05 00:20:03 IST*

### 2026-08-05

#### 00:20:03 IST - T29: Release archive repair and automated verification
- Modified `scripts/build-archive.mjs` - Added styles.css to the distributable plugin ZIP.
- Modified `src/gitManager.ts` - Extracted the bounded, zero-copy ArrayBuffer iterator for direct automated verification.
- Created `tests/archive.test.mjs` - Verifies the release ZIP contains all runtime files and the current manifest version.
- Created `tests/git-manager.test.mjs` - Verifies chunking and progress callback behavior with a minimal Obsidian host stub.
- Modified `test-isomorphic-git.mjs` - Runs end-to-end Git init, status, add, commit, log, and branch checks in a temporary repository.
- Modified `package.json` and `README.md` - Added pnpm test and corrected the development watch command.
- Updated T29 task, active context, session cache, and CI/CD implementation details - Recorded package and verification status; mobile acceptance remains open.

### 2026-06-02

#### 14:45:00 IST - T33: Git Progress Modal + UI Fixes (Issues #1, #4)
- Created `src/ui/GitProgressModal.ts` — New component: 291 lines, dark theme with Git Bash aesthetic, phase-by-phase progress tracking (Counting/Receiving/Resolving/Writing objects), progress bars, transfer rates, status icons (✓/✗/⟳), auto-close on success, error display on failure, falls back to Notice if app unavailable
- Modified `src/gitManager.ts` — Added `toAsyncIterator()` with 64KB `subarray()` chunking: prevents OOM on mobile by yielding ArrayBuffer views instead of copying entire packfile into memory
- Modified `src/gitManager.ts` — Added `onMessage` support alongside `onProgress` for text-based progress updates (requestUrl doesn't emit standard progress events)
- Modified `src/gitManager.ts` — `shallowFetchAndCheckout()`: Uses `git.clone` first (memory-efficient), falls back to `git.fetch` + `onMessage`
- Modified `src/gitManager.ts` — `createProgressNotice()`: Returns `[onProgress, onMessage, hideNotice]` tuple
- Modified `src/gitManager.ts` — Integrated `GitProgressModal` into `pull()`, `push()`, `cloneRepository()`, `shallowFetchAndCheckout()`
- Modified `src/gitManager.ts` — Added `fetchCommitFilesFromGitHub()` static method: GitHub API fallback for commit file expansion when shallow clones lack parent objects
- Modified `src/gitManager.ts` — `getCommitFiles()`: Downgrades 'not found' errors to warnings (expected with `depth:1` shallow clones)
- Modified `src/views/GitSidebarView.ts` — Commit rows: click handler moved to full row (entire row clickable, not just message text)
- Modified `src/views/GitSidebarView.ts` — Toggle bar: centered, buttons `flex: none`, desktop breakpoint for wider buttons
- Modified `src/views/GitSidebarView.ts` — Detail/meta padding: 32px consistent alignment
- Modified `src/views/GitSidebarView.ts` — Expanded state styling: `background-secondary-alt` background
- Modified `src/views/GitSidebarView.ts` — `renderCommitDetail()`: Tries GitHub API fallback when local `getCommitFiles()` fails, shows "Commit details not available locally" instead of error toast
- Modified `styles.css` — Major overhaul (400+ lines across 5 commits): dark modal theme with animations, Changes tab pill buttons (border-radius: 20px), purple filled commit button, red force push, always-visible file action buttons, purple M status icons, Commits tab centered toggle bar, expanded state backgrounds, larger fonts, origin badge styling
- Modified `styles.css` — Desktop UI now matches mobile screenshots exactly (per user-provided images)
- 5 commits: `611d1c8` (modal), `4c9c7ec` (progress fix), `f388fc7` (crash + layout), `097300a` (commit files + UI match), `43352a9` (commits style)

### 2026-06-01

#### 16:19:00 IST - T29: Bug fixes from debug log analysis
- Modified `src/gitManager.ts` — Added `gracefulEmptyRepoPull()`: When pull fails with "empty repo" errors, falls back to fetch + checkout flow instead of crashing
- Modified `src/gitManager.ts` — Added connection retry logic: 3 attempts with exponential backoff for network failures
- Modified `src/gitManager.ts` — Fixed GitHub API logging: API responses now logged at debug level with full request/response for troubleshooting
- Modified `src/gitManager.ts` — Fixed `refs/heads` error matching: pattern now correctly matches "Could not find HEAD refs/heads/main" etc.
- Modified `src/logger.ts` — Fixed export directory: ensures parent directory exists before writing debug log file
- Modified `src/main.ts` — Added Export Logs button in settings tab for quick access
- Modified `src/views/GitSidebarView.ts` — Empty repo handling: shows "No commits yet" instead of error for fresh repos
- 1 commit: `8d56344` — 5 bug fixes applied
- 1 docs commit: `cca13bb` — Session documentation for debug log analysis

#### 12:15:00 IST - T32: Mobile crash fix + remote commits without local repo
- Modified `src/gitManager.ts` — Added `GitProgressEmitter` class: EventEmitter-compatible for isomorphic-git progress events
- Modified `src/gitManager.ts` — Added `createProgressNotice()` helper: returns `[onProgress, hideNotice]` tuple, updates persistent Notice with phase/percentage/KB
- Modified `src/gitManager.ts` — Added `fetchRemoteCommitsViaApi()`: instance method using GitHub REST API for remote commits
- Modified `src/gitManager.ts` — Added `static fetchRemoteCommitsFromGitHub()`: static method for use without GitManager instance (no fs/dir needed)
- Modified `src/gitManager.ts` — Added `hasLocalCommits()`: checks if `git.log({ ref: 'HEAD', depth: 1 })` returns any commits
- Modified `src/gitManager.ts` — Added `cloneRepository()`: wraps `git.clone()` with progress tracking, depth parameter (default 1)
- Modified `src/gitManager.ts` — Added `shallowFetchAndCheckout()`: `git.fetch({ depth: 1 })` + `git.checkout()` for empty repos
- Modified `src/gitManager.ts` — Modified `pull()`: checks `hasLocalCommits()`, redirects to `shallowFetchAndCheckout()` if empty, uses `onProgress`
- Modified `src/gitManager.ts` — Modified `push()`: uses `onProgress` for progress tracking
- Modified `src/gitManager.ts` — Modified `initializeRepo()`: uses `cloneRepository()` instead of inline `git.clone()`
- Modified `src/logger.ts` — Added `exportToFile()`: writes all in-memory log entries to markdown file in vault, emoji-coded levels, JSON excerpts
- Modified `src/main.ts` — Added command `git-sync-export-logs`: "Export debug logs" to command palette
- Modified `src/views/GitSidebarView.ts` — `renderCommitsTab()`: handles `gitManager === null` for remote mode via `GitManager.fetchRemoteCommitsFromGitHub()`
- Modified `src/views/GitSidebarView.ts` — `renderCommitsTab()`: local mode shows empty-state when no local repo
- Build passes, committed to GitHub (1140c07)

#### 09:06:00 IST - T29: v25 Commits tab redesign + CI workflow
- Modified `src/gitManager.ts` - Added `getCommitFiles()` method: recursively diffs commit trees to find added/modified/deleted files for expandable commit view
- Modified `src/gitManager.ts` - Added `getRemoteLog()` method: fetches `origin/main` (or configured branch) commits via `git.log({ ref: 'origin/branch' })`
- Modified `src/gitManager.ts` - Added private `readTreeRecursive()` helper for tree traversal
- Modified `src/views/GitSidebarView.ts` - Renamed "History" tab to "Commits"
- Modified `src/views/GitSidebarView.ts` - Added `commitsViewMode` state ('local' | 'remote') with toggle bar UI
- Modified `src/views/GitSidebarView.ts` - Made commits expandable: click to show changed files with +/−/● icons
- Modified `src/views/GitSidebarView.ts` - Added `renderCommitDetail()` for lazy-loaded file change lists
- Modified `styles.css` - Added `.git-commits-toggle-bar`, `.git-commits-toggle-btn`, `.git-commits-toggle-active` styles
- Modified `styles.css` - Added `.git-commit-detail`, `.git-commit-file-row`, file status icon styles (+ green, − red, ● blue)
- Modified `styles.css` - Added `.git-commit-remote` with accent left border and `.git-commit-remote-badge`
- Created `README.md` - Comprehensive documentation: features, installation, setup, troubleshooting, changelog
- Created `screenshots/sidebar-overview.jpg` - Full sidebar view for README
- Created `screenshots/changes-tab.jpg` - Changes tab with staged/uncommitted files
- Created `screenshots/commits-tab.jpg` - Commits tab with Local/Remote toggle and expandable files
- Created `.github/workflows/build-release.yml` - GitHub Actions workflow: build, archive, upload artifact on push/PR
- Created `.github/workflows/build-release.yml` - `dev-release` job: creates/updates `dev` pre-release on every push to main
- Created `.github/workflows/build-release.yml` - `release` job: creates stable release on `v*` tags
- Modified `pnpm-workspace.yaml` - Added `packages: ['.']` field for pnpm CI compatibility
- Modified `README.md` - Updated installation instructions to reference GitHub Releases

### 2026-05-31

#### 18:15:00 IST - T29: v16 — Empty file read + History tab noise
- Modified `src/adapters/ObsidianFsAdapter.ts` — `readFileImpl()`: Changed `if (arrayBuffer && arrayBuffer.byteLength > 0)` to `if (arrayBuffer != null)` — empty files (byteLength=0) ARE valid and readable by git.add()
- Modified `src/views/GitSidebarView.ts` — `renderHistoryTab()`: Changed `log.warn()` to `log.debug()` for fresh repos with no commits — prevents toast noise on mobile
- Modified `src/adapters/ObsidianFsAdapter.ts` — Added direct fs methods (readFile, writeFile, etc.) as class properties so isomorphic-git can call them directly, not just via fs.promises
- Build passes, committed to GitHub (6b58d77)

#### 17:55:00 IST - T29: v15 — History tab empty-state for fresh repos
- Modified `src/views/GitSidebarView.ts` — `renderHistoryTab()`: Detects "no commits" errors ("Could not find", "refs/heads", "unknown revision") and shows friendly "No commits yet — stage files and tap Sync" message instead of error toast
- Build passes, committed to GitHub

#### 17:52:00 IST - T29: v14 — Fix path duplication in ObsidianFsAdapter readdir()
- Modified `src/adapters/ObsidianFsAdapter.ts` — `readdir()`: Added `stripDirPrefix` helper to strip directory prefix from Obsidian `list()` results (returns vault-root-relative paths, not directory-relative)
- Build passes, committed to GitHub

#### 17:48:00 IST - T29: v13 — Buffer polyfill for mobile only
- Added `buffer` npm package dependency
- Modified `src/main.ts`: Mobile-only polyfill — `globalThis.Buffer = require('buffer').Buffer` (guarded by `!isDesktop`)
- Desktop keeps native Node.js Buffer untouched
- Build passes, committed to GitHub

#### 17:45:00 IST - T29: v12 — Fix statusBarItem null check in ensureGitManager()
- Modified `src/main.ts` — `ensureGitManager()`: Removed `if (!this.statusBarItem) return null;` — status bar is optional on mobile
- Modified `src/gitManager.ts` — `refreshStatus()`: Only calls `setText()` if `statusBarItem` exists
- Build passes, committed to GitHub

#### 17:25:00 IST - T29: v11 — Platform detection + diagnostics command
- Added `isDesktop` property to plugin class — detects Electron by checking `window.require` and `window.process`
- Rewrote `detectRealGitRepo()` to be platform-aware (desktop: Node fs first, mobile: adapter + findRoot)
- Restored diagnostic command: "Run compatibility diagnostics" — shows platform, fs checks, repo detection, git init test
- Build passes, committed to GitHub

#### 15:45:00 IST - T29: v10 — Fix `findRoot` directory path bug
- Modified `src/main.ts` — `detectRealGitRepo()`: Changed `findRoot` from `filepath: '.'` to `filepath: 'dummy.txt'` + Node fs fallback
- Modified `src/main.ts` — `ensureGitManager()`: Clear `this.gitManager` and return `null` when `isRepository()` returns false
- Modified `src/gitManager.ts` — `isRepository()`: Changed `filepath: this.dir` to `filepath: 'dummy.txt'`
- Build passes, committed to GitHub

#### 13:30:00 IST - T29 Phase 3: Pack index fix, settings UI, Initialize button, v9
- Created `src/adapters/ObsidianFsAdapter.ts` — Custom filesystem adapter for isomorphic-git using Obsidian's DataAdapter API
- Created `src/gitManager.ts` — GitManager class wrapping isomorphic-git operations (init, clone, add, commit, push, pull, status, log)
- Created `src/views/GitSidebarView.ts` — Three-tab sidebar view (Status/History/Log) with file staging, commit viewing, and action buttons
- Created `src/logger.ts` — Structured logging utility with context prefix
- Created `src/main.ts` — Main plugin entry point with settings tab, sync command, and git manager lifecycle
- Modified `src/adapters/ObsidianFsAdapter.ts` — Node.js fs fallback for desktop (Electron window.require) to read .git/objects/pack/*.idx files that Obsidian's readBinary returns null for
- Modified `src/views/GitSidebarView.ts` — Added settings icon (gear), refresh interval control, Initialize button for new repos, correct header state for no-repo vs detected-repo
- Modified `src/main.ts` — Added `refreshInterval` setting, `initializeNewRepo()` method, `updateRefreshInterval()` on sidebar, `ensureGitManager()` lazy init
- Modified `src/gitManager.ts` — Fixed `getChangedFiles()` to return row[0] from statusMatrix, `getDetailedStatus()` with error handling, `sync()` skips push/pull when no repo URL, `initializeRepo()` with optional remote
- Modified `styles.css` — Zen mode, settings button, dropdown styling, mobile responsiveness, horizontal scroll ActionBar, uninit container styles
- Created `memory-bank/tasks/T29.md` — Renamed from T6, merged with detailed workspace content
- Created `memory-bank/implementation-details/T29-obsidian-git.md` — Architecture documentation from workspace
- Created `memory-bank/edits/2026-05-31/133000-T29-edit-chunk.md` — Edit chunk from workspace
- Created `memory-bank/sessions/2026-05-31-morning.md` — Merged with detailed session log from workspace
- Removed `memory-bank/tasks/T6.md` — Replaced by T29

### 2026-05-30

#### 23:25:00 IST - T6, T7: New tasks created per user request
- Created `memory-bank/tasks/T6.md` — Git Sidebar UI (status panel, log view, commit history, branch info)
- Created `memory-bank/tasks/T7.md` — Multi-Repo Support (repos in subfolders, per-repo settings, auto-detection)
- Updated `memory-bank/tasks.md` — Registry now shows 7 tasks (5 completed, 2 active)
- Updated `memory-bank/activeContext.md` — Current focus on T6 and T7
- Updated `memory-bank/session_cache.md` — Session updated with new tasks

#### 22:56:00 IST - T3: Mobile compatibility achieved — v9 works on mobile!
- Modified `esbuild.config.mjs` — Banner now always ensures `process.cwd` exists (even if `process` partially defined on mobile)
- Post-processed `main.js` — Added `globalThis.Buffer = require_buffer().Buffer;` at end of bundle
- Built `dist/obsidian-git-sync-v9.zip` — tested and confirmed working on mobile device
- Updated `memory-bank/tasks/T3.md` — Status changed to COMPLETED
- Updated `memory-bank/activeContext.md` — T3 marked complete
- Updated `memory-bank/progress.md` — Mobile milestones marked complete

#### 21:46:00 IST - T3: Build and verify mobile bundle
- Modified `esbuild.config.mjs` — Removed `buffer` and `path` from `builtins` external list so they are bundled
- Modified `package.json` — Added `buffer` npm package dependency (needed by `safe-buffer` via `isomorphic-git` → `sha.js`)
- Modified `esbuild.config.mjs` — Added banner that stubs `process` and `Buffer` for mobile WebView
- Built `main.js` (526K) — verified no `require("buffer")` or `require("path")` in bundle
- Created `dist/obsidian-git-sync-v6.zip` — 107K zip with main.js + manifest.json

#### 21:35:00 IST - T1-T5: Memory bank expansion and task separation
- Created `memory-bank/tasks/T1.md` — Core Git Integration task details
- Created `memory-bank/tasks/T2.md` — Plugin Commands & UI task details
- Created `memory-bank/tasks/T3.md` — Mobile Compatibility task details
- Created `memory-bank/tasks/T4.md` — Auto-sync & Background task details
- Created `memory-bank/tasks/T5.md` — Error Handling & Logging task details
- Updated `memory-bank/tasks.md` — Expanded registry with 5 tasks (1 active, 4 completed)
- Updated `memory-bank/implementation-details/T29-obsidian-git.md` — Architecture documentation from workspace
- Updated `memory-bank/implementation-details/git-http-client.md` — requestUrl architecture documentation
- Updated `memory-bank/implementation-details/mobile-compatibility.md` — Mobile strategy and winston replacement docs
- Updated `memory-bank/activeContext.md` — Current focus on T3, completed tasks listed
- Updated `memory-bank/progress.md` — Phase tracking with milestones
- Updated `memory-bank/session_cache.md` — Evening session tracking
- Created `memory-bank/sessions/2026-05-30-evening.md` — Session log

#### 21:20:00 IST - T1: Replace proxy with requestUrl, add commands, fix bugs
- Modified `src/gitManager.ts` — Replaced proxy-based GitHttpClient with requestUrl-based client
- Modified `src/gitManager.ts` — Added requestUrl to handle binary pack files via ArrayBuffer
- Modified `src/main.ts` — Added commands: sync-now, pull, push, status, test-compatibility
- Modified `src/main.ts` — Added settings UI for repo URL, auth, auto-sync interval
- Modified `src/main.ts` — Added ribbon icon and status bar
- Created `src/logger.ts` — Simple Logger to replace winston (no Node.js deps)
- Modified `esbuild.config.mjs` — Added `path-browserify` for mobile compatibility
- Modified `package.json` — Added `isomorphic-git`, `path-browserify`, `@isomorphic-git/lightning-fs`
- Modified `package.json` — Removed `winston` dependency

#### 21:15:00 IST - T1: Build verification and mobile prep
- Modified `src/main.ts` — Added test-compatibility command with 7 tests
- Modified `src/main.ts` — Added LightningFS initialization and GitManager setup
- Modified `src/gitManager.ts` — Added `getStatus()` with ahead/behind calculation
- Modified `src/gitManager.ts` — Added `sync()` with pull, add, commit, push sequence
- Modified `src/gitManager.ts` — Added `getChangedFiles()` via statusMatrix

#### 21:10:00 IST - T1: Initial git integration
- Created `src/gitManager.ts` — GitManager class with clone, pull, push, commit, add
- Created `src/main.ts` — Plugin entry point with settings and commands
- Modified `esbuild.config.mjs` — Added `path-browserify` alias for `path` module

### 2026-05-28

#### 20:16:00 IST - INIT: Memory bank initialized
- Created `memory-bank/tasks.md` — Task registry
- Created `memory-bank/session_cache.md` — Session tracking
- Created `memory-bank/activeContext.md` — Current context
- Created `memory-bank/edit_history.md` — Edit history (this file)
- Created `memory-bank/implementation-details/` — Knowledge layer directory
