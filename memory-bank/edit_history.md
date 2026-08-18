# Edit History

*Created: 2026-05-28 20:16:00 IST*
*Last Updated: 2026-08-18 13:32:46 IST*

---

## 2026-08-18

#### 13:32:46 IST - T29: Close out contextual sidebar UX session
- Modified `memory-bank/tasks/T29.md` - Corrected the historical bulk-stage wording, recorded the published commit, generated the session title, and recorded the next-session acceptance handoff.
- Modified `memory-bank/activeContext.md` - Marked the sidebar UX as published while retaining mobile, authentication, and release gates.
- Modified `memory-bank/progress.md` - Recorded the published commit and next session entry point.
- Modified `memory-bank/tasks.md` - Updated the T29 registry title and timestamp.
- Modified `memory-bank/session_cache.md` - Recorded the closeout title, pushed commit, and recent session history.
- Modified `memory-bank/sessions/2026-08-18-afternoon.md` - Appended the final verification, push evidence, and next-session handoff.
- Modified `memory-bank/changelog.md` - Recorded the session closeout and publication evidence.
- Modified `memory-bank/edit_history.md` - Added the closeout entries for the generated edit-history view.

#### 13:05:58 IST - T29: Record approved sidebar UX and mockups
- Modified `memory-bank/tasks/T29.md` - Recorded the approved contextual sidebar actions, explicit bulk labels, mockup paths, and implementation follow-up.
- Modified `memory-bank/implementation-details/T29-obsidian-git.md` - Added the approved three-tab interaction model.
- Modified `memory-bank/implementation-details/gitignore-controls.md` - Updated the control locations and closed the old first-ten-files wording.
- Modified `memory-bank/activeContext.md` - Synchronized the active UI work and next verification gate.
- Modified `memory-bank/progress.md` - Recorded the sidebar UX implementation and verification gate.
- Modified `memory-bank/session_cache.md` - Started the dated UI implementation session.
- Created `memory-bank/sessions/2026-08-18-afternoon.md` - Recorded the approved UI implementation session.
- Created `memory-bank/assets/ui-mockups/sidebar-changes-approved.png` - Added the approved Changes mockup.
- Created `memory-bank/assets/ui-mockups/sidebar-commits-approved.png` - Added the approved Commits mockup.
- Created `memory-bank/assets/ui-mockups/sidebar-log-approved.png` - Added the approved Log mockup.
- Modified `src/views/GitSidebarView.ts` - Implemented the contextual footer, commit modal, action menus, header refresh, tab-specific layout, and Log utilities.
- Modified `src/logger.ts` - Added in-memory activity-log clearing.
- Modified `styles.css` - Added the approved contextual sidebar styles.

### 2026-08-12

#### 15:59:54 IST - T29/T35b/T35e: Record gitignore controls and acceptance follow-ups
- Created `memory-bank/implementation-details/gitignore-controls.md` - Recorded hidden-dotfile editing, ignore actions, the small GitHub fixture, and the bulk-staging follow-up.
- Created `memory-bank/sessions/2026-08-12-afternoon.md` - Recorded the session work, verification, shipped commit, and deferred Add all investigation.
- Modified `memory-bank/tasks/T29.md` - Recorded `.gitignore` controls, `git-test-small`, and the first-ten-files bulk-stage issue.
- Modified `memory-bank/tasks/T35b.md` - Recorded the bulk-stage limit as an operation/staging follow-up.
- Modified `memory-bank/tasks/T35e.md` - Recorded the stable-channel 404, false up-to-date result, and generated-artifact identity evidence.
- Modified `memory-bank/activeContext.md`, `memory-bank/progress.md`, `memory-bank/tasks.md`, and `memory-bank/session_cache.md` - Synchronized current context, progress, registry timestamp, and session closeout.
- User approval: Explicit request to update Memory Bank, create/update task and implementation-detail records, commit, and push.

#### 13:59:20 IST - T35b/T35c/T35d: Record limited resume and progress closeout
- Modified `memory-bank/tasks/T35b.md` - Marked the implemented progress, cancellation, interrupted-clone retention, and retry evidence complete while retaining broader coordination gates.
- Modified `memory-bank/tasks/T35c.md` - Recorded explicit checkout recovery metadata and file-level retry without another remote request.
- Modified `memory-bank/tasks/T35d.md` - Marked separate progress namespaces, object callbacks, and checkout instrumentation complete while retaining streaming-transport and device gates.
- Modified `memory-bank/activeContext.md` - Recorded the implementation closeout, current test count, and remaining hardening work.
- Modified `memory-bank/session_cache.md` - Added the requested session title and synchronized the current focus.
- Modified `memory-bank/sessions/2026-08-12-startup-clone-fix.md` - Appended the session title, Memory Bank closeout, verification, and remaining gates.
- Modified `memory-bank/tasks.md`, `memory-bank/tasks/T29.md`, `memory-bank/tasks/T35.md`, `memory-bank/progress.md`, and `memory-bank/implementation-details/clone-resume-and-progress.md` - Synchronized timestamps, release impact, and verification evidence.

#### 13:25:00 IST - T35b/T35c/T35d: Implement resumable clone and progress statistics
- Modified `src/gitManager.ts` - Replaced fresh/shallow `git.clone` with explicit init/fetch/checkout, retained partial `.git` state, corrected target-repository detection, added cancellation-aware HTTP/checkout progress, and wired separate transfer telemetry.
- Modified `src/ui/GitProgressModal.ts` - Added object/data/file statistics, rate, ETA, phase cards, cancellation, completion/failure handling, and the mockup-aligned layout contract.
- Modified `src/adapters/ObsidianFsAdapter.ts` - Added temporary worktree write-byte callbacks for checkout telemetry.
- Modified `styles.css` - Added statistics cards, checkout rows, phase-card styling, and responsive modal layout.
- Modified `tests/git-manager.test.mjs` and created `tests/adapter.test.mjs` - Added byte/cancellation, failed-clone retention, progress-unit, and adapter write telemetry coverage.
- Updated T29/T35b/T35c/T35d and implementation-detail, progress, active-context, session-cache, and session records - Recorded the implementation boundary and remaining native transport/coordination limitations.

#### 13:45:00 IST - T35b/T35c: Resume checkout without refetching
- Modified `src/gitManager.ts` - Added checkout-pending metadata containing the fetched branch tip; retries validate the local commit, skip fetch, resume checkout, and clear the marker only after success.
- Modified `tests/git-manager.test.mjs` - Added a completed-fetch checkout-resume regression test proving zero HTTP requests on retry.
- Updated `memory-bank/implementation-details/clone-resume-and-progress.md`, T35b/T35c, progress, active context, and session cache - Recorded file-level resume behavior and its acceptance boundary.

#### 13:13:05 IST - T35b/T35d: Record clone recovery and progress telemetry gaps
- Modified `memory-bank/tasks/T29.md` - Added the release impact of resumable clone and trustworthy transfer-metrics requirements.
- Modified `memory-bank/tasks/T35.md` - Added the new hardening evidence and focused implementation-detail link.
- Modified `memory-bank/tasks/T35b.md` - Added clone recovery, cancellation, retry, and lifecycle acceptance criteria.
- Modified `memory-bank/tasks/T35c.md` - Added partial `.git` preservation and interruption-safety requirements.
- Modified `memory-bank/tasks/T35d.md` - Added separate byte, object, file, rate, ETA, and indeterminate-progress requirements.
- Created `memory-bank/implementation-details/clone-resume-and-progress.md` - Recorded current evidence, recovery choices, metrics contract, ownership, and acceptance tests.
- Modified `memory-bank/implementation-details/reliability-and-lifecycle.md` - Added the clone recovery and modal cancellation boundary.
- Modified `memory-bank/implementation-details/git-http-client.md` - Clarified full-response buffering and progress telemetry limits.
- Modified `memory-bank/activeContext.md` - Marked T35b/T35d active and recorded the design follow-up.
- Modified `memory-bank/progress.md` - Recorded the clone/progress audit and open implementation boundary.
- Modified `memory-bank/tasks.md` - Synchronized T35b/T35d statuses and registry counts.
- Modified `memory-bank/session_cache.md` - Updated current focus and active-task registry.
- Modified `memory-bank/sessions/2026-08-12-startup-clone-fix.md` - Appended the follow-up audit and documentation closeout.
- Created `screenshots/progress-modal-stats-mockup.png` - Added a high-fidelity design mockup showing object, byte, rate, ETA, and file statistics.

### 2026-08-12

#### 11:31:05 IST - T35c: Prevent startup cloning and harden repository initialization
- Modified `src/main.ts` - Made manager creation and passive sidebar refresh read-only; prevented auto-sync and normal sync from initializing a missing repository.
- Modified `src/gitManager.ts` - Required an existing local repository for normal sync.
- Modified `src/views/GitSidebarView.ts` - Reserved initialization for explicit Clone Remote actions.
- Modified `tests/git-manager.test.mjs` - Added regression coverage proving normal sync does not contact a remote without `.git`.
- Updated `memory-bank/tasks/T35c.md`, `memory-bank/activeContext.md`, `memory-bank/progress.md`, and `memory-bank/session_cache.md` - Recorded the fix, verification, remaining safety gates, and session handoff.

### 2026-08-11

#### 02:39:18 IST - T35a/T35c: Close architecture and credential-planning session
- Updated `session_cache.md` - Marked the current session closed and preserved the next-session approval gate.
- Updated `sessions/2026-08-11-early-morning.md` - Recorded the final closeout, deferred implementation boundary, and active next-session tasks.

### 2026-08-11

#### 02:31:07 IST - T35a/T34b: Record secure Git-credential storage plan
- Modified `memory-bank/implementation-details/security-and-secrets.md` - Recorded Obsidian SecretStorage guidance, related credential methods, threat model, and implementation sequence.
- Modified `memory-bank/tasks/T35a.md` - Added the SecretStorage, migration, just-in-time resolution, unsupported-platform, staging, redaction, and acceptance plan.
- Modified `memory-bank/tasks/T34b.md` - Required device-flow credentials to use SecretStorage without a plaintext fallback.
- Updated `memory-bank/activeContext.md`, `memory-bank/progress.md`, `memory-bank/tasks.md`, and `memory-bank/session_cache.md` - Synchronized the active design decision and next approval gate.
- Updated `memory-bank/sessions/2026-08-11-early-morning.md` - Appended the secure-storage follow-up and confirmed no production code or credential data changed.

### 2026-08-11

#### 02:20:28 IST - T35a/T35c: Complete read-only source audit
- Modified `tasks/T35a.md` and `tasks/T35c.md` - Recorded evidence locations and acceptance gates for credential/staging and repository-state/destructive-operation risks.
- Modified `tasks/T35.md` and `tasks.md` - Marked T35a/T35c active for audit/design while preserving the no-production-implementation boundary.
- Modified `implementation-details/security-and-secrets.md` and `implementation-details/reliability-and-lifecycle.md` - Added current-source audit evidence and implementation sequencing notes.
- Updated `activeContext.md`, `progress.md`, `session_cache.md`, and `sessions/2026-08-11-early-morning.md` - Recorded the audit results, passing baseline tests, and next approval gates.

### 2026-08-11

#### 02:14:36 IST - T35: Initialize missing Memory Bank support files
- Created `memory-bank/protocols/` and `memory-bank/templates/` - Added the missing mb-core workflow protocols and reusable templates.
- Created `memory-bank/changelog.md`, `memory-bank/errorLog.md`, `memory-bank/productContext.md`, `memory-bank/systemPatterns.md`, `memory-bank/techContext.md`, `memory-bank/.cursorrules`, and `memory-bank/README.md` - Added missing Memory Bank support files without replacing existing records.
- Created `memory-bank/integrated-rules-v6.12.md` - Added the bundled Memory Bank rules file; its shipped v6.11 content remains queued for separate version review.
- Modified `memory-bank/README.md` - Corrected mb-core's generated day/month-swapped initialization date.
- Updated `memory-bank/activeContext.md`, `memory-bank/session_cache.md`, and `memory-bank/sessions/2026-08-11-early-morning.md` - Recorded the safe bootstrap and version-boundary note.
- Recorded the missing `memory-bank/templates/commit_message_template.md` source warning - Left the template absent rather than creating an unverified replacement.

### 2026-08-11

#### 02:03:27 IST - T35/T34/T29: Architecture review recorded and hardening work decomposed
- Created `tasks/T35.md` - Added the cross-cutting reliability, security, lifecycle, transport, updater, testing, and documentation hardening parent.
- Created `tasks/T35a.md`, `tasks/T35b.md`, `tasks/T35c.md`, `tasks/T35d.md`, `tasks/T35e.md`, and `tasks/T35f.md` - Split the review findings into credential safety, operation coordination, initialization safety, mobile transport, updater integrity, and test/CI/documentation follow-ups.
- Modified `tasks/T34a.md` - Added secret-safe logging, staging exclusions, and credential-freshness acceptance criteria.
- Modified `tasks/T29.md` - Recorded the release impact and linked T35 without expanding T29 beyond release packaging and acceptance ownership.
- Created `implementation-details/security-and-secrets.md` - Defined credential storage, redaction, and automatic staging boundaries.
- Created `implementation-details/reliability-and-lifecycle.md` - Defined operation coordination, repository states, progress ownership, and unload behavior.
- Modified `implementation-details/T34-remote-authentication.md`, `implementation-details/T29-obsidian-git.md`, `implementation-details/git-http-client.md`, `implementation-details/mobile-compatibility.md`, and `implementation-details/ci-cd-architecture.md` - Recorded durable review findings and ownership boundaries.
- Updated `tasks.md`, `activeContext.md`, `progress.md`, `session_cache.md`, and `sessions/2026-08-11-early-morning.md` - Synchronized the new T35 task tree, current focus, release gate, and session record.

### 2026-08-10

#### 23:19:04 IST - T29: Plugin auto-updater and direct dist artifacts
- Created `src/updater/PluginUpdater.ts` - Added stable/dev GitHub release checks, commit-hash matching, mobile-safe downloads, manifest validation, backup, transactional rollback, and update modal.
- Created `src/buildInfo.ts` and modified `esbuild.config.mjs` - Embedded the full Git commit hash in production bundles for rolling dev release identity.
- Modified `src/main.ts`, `styles.css`, and `README.md` - Added updater settings, manual/startup checks, channel/hash display, and user documentation.
- Modified `.github/workflows/build-release.yml` - Published direct runtime assets alongside stable/dev ZIP releases.
- Modified `scripts/build-archive.mjs` and `tests/archive.test.mjs` - Copied plugin files directly into `dist/` and verified the unpacked output.
- Created `tests/updater.test.mjs` - Added channel, hash, asset validation, plugin identity, and rollback coverage.
- Updated T29 task, implementation details, active context, progress, session cache, and session log - Recorded implementation, verification, and remaining mobile/authentication gates.

### 2026-08-10

#### 22:34:02 IST - T34: Remote authentication task split and session closeout
- Created `tasks/T34.md` - Separate parent task for remote authentication, distinct from T29 release work.
- Created `tasks/T34a.md`, `tasks/T34b.md`, and `tasks/T34c.md` - Defined PAT diagnostics, optional GitHub device flow, and cross-device acceptance boundaries.
- Created `implementation-details/T34-remote-authentication.md` - Recorded the read-only connection-test architecture, Android evidence, and secret-safe diagnostic design.
- Created `sessions/2026-08-10-night.md` - Closed the session with release evidence, Android findings, and deferred work.
- Updated `tasks.md`, `activeContext.md`, `session_cache.md`, and `progress.md` - Registered T34, preserved T29's release-only scope, and set T34a as active.

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
