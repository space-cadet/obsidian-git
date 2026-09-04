# Active Context

*Last Updated: 2026-09-04 20:18:35 IST*

## Current Tasks

### T38: Current Product Specification and Rewrite PRD Foundation — 🔄
- **Scope**: Record the current product's user-visible features, UI, Settings,
  platform behaviour, and evidenced edge cases in one canonical specification.
- **Status**: `memory-bank/product-spec.md` and the first
  `memory-bank/product-prd.md` draft are created and linked from
  `productContext.md`. Both are product-facing and implementation-agnostic.
  The PRD now explicitly defines a UI-preserving mechanics replacement and
  carries forward the proven `obsidian-ai`-derived updater behaviours.
- **Next**: Review the specification and PRD. The next session will create the
  rewrite task as the new origin task.

### T29: obsidian-git Plugin — 🔄 sidebar and updater implementation pending runtime acceptance
- **Scope**: Complete Git sync plugin for Obsidian using isomorphic-git
- **Sub-tasks**: T1 (Core Git), T2 (Commands/UI), T3 (Mobile), T4 (Auto-sync), T5 (Error Handling), T6 (Sidebar UI), T7 (Multi-Repo — pending), T29a (Full Sidebar UI Redesign — ACTIVE), T33 (Progress Modal + UI Fixes — COMPLETED)
- **Phase 7**: v27-v29 — Git progress modal, mobile crash fix #2, desktop UI mobile match, commit file GitHub fallback
- **Status**: Core sync workflow, bulk staging behavior, and the approved three-tab interaction direction are implemented and published in commit `4292bf9`. T29a now owns the full visual redesign from the approved mockups while preserving those behaviors. Authentication-backed mobile acceptance and public release remain separate gates.
- **Next**: Verify the pushed sidebar/updater changes in Obsidian, investigate the unresolved Android keyboard overlap, and continue the repository-health and repair work before the existing mobile/release gates.

### T29a: Full Sidebar UI Redesign and Visual Acceptance — 🔄
- **Scope**: Replace the incremental sidebar presentation with one coherent
  mockup-led design across Changes, Commits, and Log.
- **Status**: Mockup-matching source-level presentation pass is implemented and
  verified by build/tests. Preserve existing Git actions, T33 completion, T34
  authentication ownership, and T35 follow-up ownership.
- **Next**: Investigate the failed Android keyboard acceptance using measured
  WebView viewport/modal bounds; compact-only layout and shared status reads are
  implemented, but real Obsidian visual acceptance remains open.

### T34: Remote Authentication for Obsidian Git — 🔄 Diagnostics active
- **Scope**: Separate authentication task covering secret-safe PAT diagnostics,
  optional GitHub device flow, and Android/desktop authentication acceptance.
- **Status**: T34a is active. The read-only remote Test Connection repair is
  shipped; Android reaches GitHub but the supplied token was rejected with
  HTTP 401 by GitHub itself. Do not record or reuse the exposed token.
- **Children**: T34a PAT diagnostics (active); T34b GitHub device flow
  (planned); T34c Android/desktop acceptance (planned).
- **Boundary**: T29 remains release packaging/acceptance. Do not make a
  v1.0.0 tag until authentication validation and remaining mobile acceptance
  are complete.

### T35: Plugin Reliability, Security, Lifecycle, Transport, Updater, and Test Follow-up — 🔄 Implementation active
- **Scope**: Concrete credential, repository, mobile transport, updater,
  testing, and documentation problems with recorded user impact.
- **Children**: T35a-T35f are active.
- **Status**: The first credential-safety implementation adds logger redaction,
  protected automatic staging, URL normalization, repository-error
  classification, and safe repository initialization boundaries. T35a
  SecretStorage is implemented; T35b now has a source-level operation
  lifecycle checkpoint, while T35c replacement backups and specific behaviour
  checks remain open. T35 is separate from T29 release ownership and T34
  authentication ownership.
- **Next**: Complete only the repository-safety and mobile acceptance work that
  is required by a demonstrated workflow. Do not add a general operation or
  cache architecture as a planning target.

### T37: Tentative Plugin Rewrite Feasibility and User-Workflow Assessment — ⏸️
- **Scope**: Decide whether demonstrated user workflows justify replacing the
  current Git mechanics.
- **Status**: Assessment document and saved Matt Pocock-style report are
  recorded; no rewrite, fork, or replacement is authorized. The current plugin
  remains the rollback baseline.
- **Next**: Run the actual affected workflows on desktop, Android, and against
  a live remote; record what works, fails, or has not been tested.

### T36: Fork and Maintain isomorphic-git — 🔄 Independent architecture task
- **Scope**: Evaluate official isomorphic-git 1.41.9, then fork, publish, and
  maintain only the smallest required changes for bulk Git mutations and
  Obsidian/mobile compatibility.
- **Status**: The upstream repository is cloned at
  `/Users/deepak/code/isomorphic-git` at tag `v1.41.9`; no fork has been
  adopted. The plugin now pins official 1.41.9 in source and lockfile; older
  1.29.0 references are historical baseline notes.
- **Boundary**: T36 is a separate top-level task, not a T35 child. Its source
  ignore regression is fixed; it must not be used to defer the mobile
  `refs/heads/main` diagnosis or broader adapter acceptance.
- **Next**: Test official 1.41.9 in a controlled branch before deciding whether
  a published fork is necessary.

### T29/T35 Maintenance and Diagnostics — 🔄 Desktop complete, mobile recovery open
- **Delivered**: Settings Maintenance and Diagnostics panels, health and local
  index repair actions, backup/restore and remote comparison previews, faster
  repair scans, persistent plugin-scoped logging, metrics, and selectable
  maintenance results.
- **Current boundary**: Local index repair does not replace a damaged
  repository or rebuild a non-empty vault from the remote.
- **Next**: Diagnose the existing mobile `typora-notes` failure where
  `refs/heads/main` cannot be resolved, starting with read-only adapter/ref
  inspection and preserving all existing vault and `.git` data.

### Current Session Continuation — 2026-09-04
- **Title**: T29a, T35b, T35d, T35f, T37, T38: Review sidebar behavior and simplify the rewrite plan
- **Completed**: Added current-source operation cancellation and cleanup,
  sidebar cache code, stale-result checks, and focused tests. These are
  implementation history, not requirements for a fresh implementation.
- **Verification**: Production build and `CI=true pnpm test` pass with 59 Node
  tests, artifact checks, 10 isomorphic-git checks, and diff validation.
- **Remaining**: Test the specific stale-view, repository-state, replacement,
  and desktop/mobile workflows that users actually encounter.

### Existing Operation Implementation — 2026-09-04
- The current source admits one mutation at a time, passes cancellation into
  GitManager, and rejects a late result after cancellation or unload.
- The current source also emits operation events and records them in the log.
  Neither the event system nor its class structure is a rewrite requirement.

### Existing Source Test — 2026-09-04
- A TypeScript-AST-backed test checks the current wrapper arrangement, and a
  focused test checks disposal and signal cleanup. These are source tests, not
  rewrite requirements. Runtime Obsidian and mobile acceptance remain
  separate.

### UI and Log Regression Fixes — 2026-09-04
- Changes-view busy state now disables all staging controls without rotating
  any checkbox; no staging checkbox uses a spinner animation.
- Successful pushes now force-update an existing local remote-tracking ref, so
  an `AlreadyExistsError` cannot be reported after the remote push succeeds.
- Persisted log data is normalized before merging, and small live/file
  timestamp drift no longer creates duplicate Log-tab events.
- Focused and full automated verification passes. Real Obsidian visual and
  mobile acceptance remains open.

### Existing Sidebar Cache — 2026-09-04
- The current source contains a cache for history, commit details, and log
  entries, with explicit invalidation and unit tests.
- It is optional implementation history. A fresh implementation should keep
  this state with the sidebar unless real use or profiling proves the cache is
  necessary.

### Stale-Read Guard — 2026-09-04
- Log loading and commit-detail responses now verify the current render
  generation before updating cache or DOM; commit details also require an
  attached row.
- Full automated verification passes. Repository-state outcomes and runtime
  desktop/mobile acceptance remain the next evidence gaps.

### Current Implementation Session — 2026-09-03 18:26 IST
- **Authorized scope**: Implement the seven confirmed sidebar, staging,
  logging, metrics, and push-progress fixes recorded in T29/T35b/T36.
- **First gate**: Test official isomorphic-git 1.41.9, centralize staging
  classification, preserve tracked paths, reject ignored untracked paths, and
  verify the index before claiming staging success.
- **Earlier follow-up record**: The previous session proposed a sidebar read
  model with loading/error states, tab caches, persistent log history, opt-in
  metrics, and operation-specific push progress. Only the user-visible parts
  that solve a demonstrated problem remain relevant.
- **Worktree safety**: Preserve the pre-existing user modification in `main.js`
  and do not overwrite unrelated generated or local work.

### Implementation Status — 2026-09-03 18:45 IST
- Official isomorphic-git 1.41.9 is pinned and passed the tracked-ignore
  reproduction plus all automated checks; no fork is currently required.
- Source fixes for all seven reported behaviors are implemented locally.
- Remaining acceptance is real Obsidian desktop/mobile behavior and remote
  timing/freshness; automated tests do not close those device gates.

### Memory Bank Follow-up — 2026-09-03 19:58 IST
- Updated the reliability, sidebar, mobile, dependency, progress, and release
  records with the follow-up commit `e2cb6ad` and its exact verification.
- Corrected the current isomorphic-git dependency record to official 1.41.9;
  historical 1.29.0 references remain labeled as baseline evidence.
- Created tentative T37 and `implementation-details/plugin-rewrite-assessment.md`
  to assess incremental extraction versus a clean rewrite. No rewrite is
  approved; the current plugin remains the rollback baseline.

### T35e Updater and Release Artifact Consistency — 🔄 implementation partial
- Ported the proven `obsidian-ai` updater pattern into `obsidian-git`: logger-backed diagnostics, cache-busted/status-aware GitHub requests, release-embedded commit identity, branch-aware dev selection, all published builds, and direct-asset validation.
- Added compile-time branch identity, branch-build CI publishing, and an explicit manual error notice so a missing stable release is not reported as up to date.
- Preserved the existing transactional install and rollback behavior. Checksums/signatures, temporary-directory cleanup on every failure path, and real Obsidian installation acceptance remain open.
- Corrected the sidebar typography to explicit compact sizes rather than theme-scaled medium text, and changed Browse Builds to enumerate all published stable, rolling-dev, and branch releases.
- Commit `910c5f5` repaired current and older dev-release metadata detection; commit-subject display and release-title cleanup remain open.
- Commit `25be638` added bounded updater requests and vault operations plus
  stale temporary-folder cleanup. Real Android installation/reload acceptance,
  checksums, and signed metadata remain open.

### T35b/T35c/T30 Follow-up Audit — 🔄 planned implementation
- Remote commit browsing must work with a configured usable remote even when
  local `.git` is missing or unhealthy.
- Sidebar reads now use one shared status snapshot with stale-render protection;
  branch comparison failure no longer hides a successful file-status scan.
  Repository repair should use temporary remote reconstruction, comparison,
  and protected replacement rather than implicit overwrite.
- These follow-ups preserve T29a visual ownership, T30 remote-history context,
  T35b refresh/lifecycle ownership, and T35c repository-recovery ownership.

### T35a Secure Credential Storage — 🔄 SecretStorage implemented
- Obsidian `SecretStorage`/`SecretComponent` is the primary planned boundary;
  settings will store only secret references after migration.
- The current `isomorphic-git`/`requestUrl` transport cannot automatically use
  native Git credential helpers, so `osxkeychain`, Git Credential Manager,
  `libsecret`, and SSH agents remain related future options rather than
  current dependencies.
- Obsidian `SecretStorage` is now the credential boundary, with per-vault secret
  IDs, legacy migration after successful writes, unsupported-host blocking, and
  just-in-time resolution before remote operations.
- Remaining T35a work is acceptance coverage for export files, mobile setup,
  secret replacement/clearing, and the same-process plugin threat model.

### T35c Startup Clone Safety — 🔄 Fix implemented
- Sidebar refresh and manager creation are now read-only.
- Only explicit Clone Remote actions may initialize or clone a fresh vault;
  auto-sync and normal sync require an existing local repository.
- Regression coverage confirms normal sync does not contact a remote when no
  local repository exists.

### T35b/T35d Clone Recovery and Progress Telemetry — 🔄 Implementation slice
- Fresh and shallow clone now use explicit init/fetch/checkout, preserving
  initialized `.git` state after fetch interruption for an explicit retry.
- A completed fetch writes a checkout-pending marker; retry validates the local
  commit, skips refetching, and resumes checkout, clearing the marker only on
  success.
- The modal now shows separate object counts, response data, rate, ETA, files,
  written bytes, phase status, and elapsed time; object counts are no longer
  formatted as data sizes.
- Modal close requests cancellation through an AbortSignal checked by the
  transport iterator, fetch callbacks, and checkout callbacks.
- `requestUrl` still buffers full responses, so byte metrics are
  response-consumption telemetry rather than live wire transfer telemetry.
- Protected replacement backups, preventing conflicting actions where needed,
  and Android/desktop real-device acceptance remain open.

### T29/T35b `.gitignore` Controls, Bulk Staging, and Sidebar UX — 2026-08-18

- Added sidebar and command-palette access to the hidden `.gitignore` file,
  per-file ignore actions, and a folder/glob pattern editor.
- Hidden-file reads and writes now use the vault adapter; an adapter-backed
  editor modal handles the case where Obsidian omits `.gitignore` from its
  indexed `TFile` list.
- Created and verified the small private `space-cadet/git-test-small` fixture
  for clone, edit, commit, push, and mobile acceptance checks.
- Fixed the visible bulk staging regression: Add all now receives the complete
  visible file list, continues after individual failures, and reports counts.
- Approved the sidebar layout represented by the three mockups in
  `memory-bank/assets/ui-mockups/`.
- The Changes footer is now action-only and tab-specific. Commit message entry,
  `.gitignore` controls, force push, per-file ignore, and log utilities are
  available on demand through modals or `More` menus.
- The current interaction implementation is retained as the T29a behavior
  contract; the full visual redesign is recorded separately.

### 2026-09-03 Session Closeout

- Source commits through `d38e28e` plus maintenance commits `986b695`,
  `22fb14e`, `840649e`, `c215f29`, `d6670c8`, `ee9edf8`, `29085ed`,
  `0069622`, and `b728470` were pushed to `origin/main`.
- The session covered sidebar redesign and compact-only density, remote commit
  browsing, `.gitignore` controls and UTF-8 parsing, updater timeouts/cleanup,
  shared status reads, and stale-history/status resilience.
- Android testing still reports keyboard overlap in the `.gitignore` dialog;
  this remains an unaccepted T29a issue despite the viewport-aware attempt.
- Current source and remote are synchronized at `b728470`; worktree was clean
  before this Memory Bank update.

### 2026-09-03 Maintenance and Diagnostics Closeout

- Maintenance and diagnostic source commits through `b728470` are pushed and
  the checkout is clean and aligned with `origin/main`.
- Recorded verification is 51 Node tests, 10 isomorphic-git checks, production
  build, artifact checks, and `git diff --check`.
- The next session must resolve the mobile missing-`refs/heads/main` problem
  for the existing non-empty `typora-notes` repository; desktop success does
  not close this device-acceptance issue.

### T33: Git Progress Modal + UI Fixes — ✅ COMPLETED
- **Scope**: Dark-themed progress modal, mobile crash fix via chunked ArrayBuffer, desktop UI parity with mobile, commit file GitHub API fallback
- **Priority**: HIGH
- **Parent**: T29
- **Status**: All 5 commits landed. Issues #1 and #4 from user testing resolved.
- **Files**: `src/ui/GitProgressModal.ts` (new), `src/gitManager.ts` (chunked fetch, progress integration), `src/views/GitSidebarView.ts` (commit row click, GitHub fallback), `styles.css` (major overhaul)

### T30: Remote Commits View — ✅ COMPLETED
- **Scope**: Display remote commit history alongside local in Commits tab (local/remote toggle)
- **Priority**: MEDIUM
- **Parent**: T29
- **Status**: Implemented in v25. Toggle between Local/Remote, expandable file lists.
- **Known Issue**: Expanding remote commits fails when local repo is empty — FIXED in v28 via `fetchCommitFilesFromGitHub()` fallback

### T31: Branch Tree View — ⏳ BACKLOG
- **Scope**: Multi-branch visualization and management
- **Priority**: LOW
- **Parent**: T29
- **Decision**: Intentionally deferred
- **Status**: Task doc created. No implementation planned.

## Completed Tasks

1. **T1: Core Git Integration** — Replaced proxy with `requestUrl`, implemented GitManager ✅
2. **T2: Plugin Commands & UI** — Added commands, settings, status bar, ribbon icon ✅
3. **T3: Mobile Compatibility** — v9 builds for desktop + mobile ✅
4. **T4: Auto-sync & Background** — Timer-based sync with cleanup ✅
5. **T5: Error Handling & Logging** — Replaced winston with simple Logger ✅
6. **T6: Git Sidebar UI** — Status panel, commit log, file staging ✅
7. **T30: Remote Commits View** — Local/Remote toggle, expandable commits ✅ (v25)
8. **T32: Mobile Crash Fix + Progress** — Shallow fetch, GitHub API fallback, progress notices, debug logs ✅ (v26)
9. **T33: Git Progress Modal + UI Fixes** — Dark modal, chunked ArrayBuffer, desktop-mobile parity, commit file fallback ✅ (v27-v29)

## T29: obsidian-git Plugin Completed Sub-Tasks
- **v17-v19**: Changes tab redesign (Staged/Uncommitted sections, per-file + bulk actions)
- **v20-v21**: Commit message input + separate Commit/Push/Pull/Refresh buttons
- **v22**: Token visibility bug fix
- **v23**: Pull author error fix, push rejection error handling, empty remote clone fallback
- **v24**: Force Push button (↑↑) with confirmation dialog
- **v25**: Commits tab redesign (renamed from History, expandable file lists, Local/Remote toggle)
- **v26**: Mobile crash fix, progress tracking, GitHub API remote commits, debug log export
- **v27**: Git progress modal with dark theme, phase-by-phase tracking
- **v28**: Progress modal fix (onMessage + onProgress), mobile crash fix #2 (64KB chunking), commits tab layout, commit file GitHub fallback, desktop UI mobile match
- **v29**: Commits tab style refinement (toggle bar, row spacing, bold text)
- **T29 updater**: Stable/dev GitHub release checks, commit-hash identity, mobile-safe install, backup/rollback, direct release assets, and unpacked `dist/` output ✅
- **README**: Full documentation with screenshots
- **CI**: GitHub Actions workflow (build, archive, artifact, dev release, stable release)

## Next Steps
1. **T34a: Add secret-safe authentication diagnostics** — distinguish invalid
   GitHub token, repository access denial, and Git HTTPS rejection.
2. **T34b decision** — Decide whether to implement GitHub device-flow sign-in.
3. **T34c + T29: Test the current dev release on Android/iOS** — Verify a
   valid remote credential, clone/pull/push, progress, and commit expansion.
4. **T35** — Complete only the concrete repository, transport, updater, or
   test work required by an observed user workflow.
5. **Create tagged v1.0.0 release** only after mobile acceptance, applicable
   T35 follow-up work, and explicit authorization.

## System Status

- **Plugin**: v1.0.0 (manifest), v29 internal dev, core features + sidebar + progress modal + crash fix + UI parity
- **Build**: ~280KB, mobile-compatible, tsc + esbuild pass
- **CI**: GitHub Actions working, dev releases on every push
- **Updater**: `PluginUpdater` uses `requestUrl` plus the vault adapter; the latest repaired generated build is embedded as commit `3f269e4` in source commit `910c5f5`
- **Dev release**: https://github.com/space-cadet/obsidian-git/releases/tag/dev
- **Memory Bank**: T29/T34/T35 active, T34a/T35a/T35b/T35c/T35d/T35e active,
  T35f in progress,
  T1-T6/T30/T32/T33 completed; T37 tentative/paused; mb-core protocols, templates, and missing
  support files initialized without overwriting existing project records
- **Branch**: `main` (isomorphic-git + ObsidianFsAdapter)

## Current Sidebar Follow-up Checkpoint — 2026-09-04

- The Log panel renders all retained entries loaded from the persistent
  plugin-scoped `debug.log`; the former view-only newest-50 cap is removed.
- Direct single-file staging uses `git.listFiles()` plus one targeted worktree
  stat instead of a full vault `statusMatrix()` scan, preserving tracked
  deletion and ignored-untracked safeguards.
- Local/Remote commit-source buttons are sticky inside the sidebar content
  scroll owner and remain available while commits scroll.
- After a single-file stage/unstage completes, the Changes view repaints from
  the updated snapshot directly instead of waiting for another repository
  status scan.
- Stage all and Unstage all now use the same direct repaint path and preserve
  partial per-file results.
- `CI=true pnpm test` passes with 72 Node tests, artifact identity,
  production build, 10 isomorphic-git checks, and `git diff --check`.
- Real Obsidian cross-session log, staging timing, and visual acceptance are
  still pending; T35c repository replacement and mobile ref work remain open.

## Session Closeout — 2026-09-04

- Session title: `T29a, T35b, T35d, T35f, T37, T38: Review sidebar behavior and simplify the rewrite plan`.
- The session delivered targeted lifecycle, Log, staging, bulk-action, and
  commit-control fixes, with generated-bundle and automated-test evidence.
- Many UI issues still remain. Keep T29a in progress and do not claim broad
  desktop/mobile visual acceptance.
- Added the current product specification and first rewrite PRD draft under
  T38. The agreed direction retains the existing UI and replaces the Git/
  repository mechanics and result-to-UI path.

## Decisions Made

- **isomorphic-git over native git**: Cross-platform compatibility ✅
- **ObsidianFsAdapter over LightningFS**: Delegates to `app.vault.adapter` ✅
- **Node.js fs fallback**: `window.require('fs')` for pack index files on desktop ✅
- **Lazy git manager init**: Only created when sidebar opens or sync command runs ✅
- **Refresh interval 0 = disabled**: No auto-refresh when set to 0 ✅
- **Local-only mode**: Skip push/pull when no repo URL configured ✅
- **PAT auth**: Any username works with fine-grained PATs ✅
- **Connection test is read-only**: It must not require a local repository or
  clone/initialize the vault ✅
- **Authentication task separation**: T34 owns remote authentication; T29 owns
  release packaging and release acceptance ✅
- **Sidebar controls are contextual**: Changes owns the commit/sync footer;
  Commits and Log use the full height ✅
- **Commit message is on demand**: It opens in a modal from `Commit (N)` ✅
- **Secondary controls are grouped**: `.gitignore`, force push, ignore, and
  log utilities are available from `More` menus ✅
- **Dev releases on every push**: `dev` tag auto-updated, pre-release, not latest ✅
- **v1.0.0 as public release**: v26 was internal dev version ✅
- **GitHub API fallback for remote commits**: Use GitHub REST API when local repo unavailable ✅
- **Shallow fetch on empty repo**: `depth: 1` prevents mobile crash on large repos ✅
- **Progress notices**: `createProgressNotice()` keeps object counts separate
  from response bytes and supports cancellation ✅
- **Debug log export**: `Logger.exportToFile()` writes markdown to vault ✅
- **Git progress modal**: Dark-themed modal with phase tracking, separate
  object/data/file statistics, rate/ETA, cancellation, auto-close, and error
  display ✅
- **Chunked ArrayBuffer for mobile**: 64KB `subarray()` chunks in `toAsyncIterator()` prevents OOM ✅
- **Desktop UI matches mobile**: Changes tab and Commits tab styled identically to mobile screenshots ✅
- **Commit file GitHub fallback**: `fetchCommitFilesFromGitHub()` for shallow clones ✅
- **Release archive contains styles**: styles.css is packaged and archive layout is tested ✅
- **Test runner**: Node built-in test runner, with a bundled source test and Obsidian host stub ✅
- **Updater identity**: Rolling dev release checks compare embedded local commit hash with GitHub `main` HEAD ✅
- **Archive output**: `pnpm run archive` creates the ZIP and copies plugin files directly into `dist/` ✅
- **Task ownership**: T35 owns its concrete reliability and security
  follow-up; T29 owns release packaging/acceptance and T34 owns remote
  authentication ✅

## Decisions Pending

- **T7 repo detection**: Auto-scan depth limit? Manual add only?
- **SSH key authentication**: Currently only Basic Auth
- **GitHub device flow**: Planned under T34b; requires a GitHub App decision
- **Conflict resolution UI**: For merge conflicts
- **Mobile pack index**: LightningFS, wasm-git, or different library?
- **Mobile acceptance**: Need real-device validation of the current dev release
- **Credential storage**: T35a must choose and document the secure-storage
  boundary and automatic staging exclusions.
- **Competing operations**: T35b must define what the user sees if two
  conflicting actions are requested, only if the current workflow requires a
  change.
- **Repository behaviour**: T35c must define safe clone, empty-remote,
  local-only, and replacement behaviour only where those workflows are
  required and observed.

## Next Steps

1. **Test v29 dev release on mobile** — Verify progress modal, chunked fetch, UI parity
2. **Confirm the CI-generated dev ZIP** — Verify it contains styles.css
3. **Create tagged v1.0.0 release** — `git tag v1.0.0 && git push origin v1.0.0`
4. **Plugin store submission prep** — manifest, README, release notes
