## 2026-09-04 — T38 KISS rewrite-plan revision

- Revised the live product and rewrite records around KISS: “Keep It Simple,
  Stupid.”
- Made demonstrated user behaviour the requirement and treated coordinators,
  caches, read models, event systems, and source-structure tests as optional
  implementation choices.
- Replaced the active rewrite next steps with real Obsidian/device workflow
  checks, specific fixes for observed failures, focused tests, and PRD approval
  before any rewrite task or branch is created.
- Preserved dated session records as historical records.

## 2026-09-04 — T29a/T35b/T35f bulk action repaint

- Fixed Stage all and Unstage all so they repaint Changes immediately after
  their Git operation instead of starting a second full repository refresh.
- Stage all moves only successful files; Unstage all now returns per-file
  success/failure data so partial results remain accurate in the UI.
- Added source-level regression coverage for the bulk completion path.
- Verification passed: 72 Node tests, artifact identity, production build, 10
  isomorphic-git checks, and `git diff --check`.
- This was targeted work only; many UI issues remain unresolved and real
  Obsidian visual/runtime acceptance is still open.

## 2026-09-04 — T29a/T35b/T35d/T35f/T37 sidebar follow-up

- Removed the Log panel's newest-50 display cap so all bounded persistent and
  live entries can be viewed, including entries from prior sessions present in
  `debug.log`.
- Avoided a full vault `statusMatrix()` scan for direct single-file staging by
  using the Git index and a targeted worktree existence check; deletion and
  `.gitignore` behavior remain protected.
- Made the Local/Remote commit-source buttons sticky while the chosen commit
  list scrolls.
- Repainted the Changes view directly after a completed single-file stage or
  unstage action instead of starting a second full repository status read.
- Added source-level regression checks for all three reported behaviors.
- Verification passed: 71 Node tests, artifact identity, production build, 10
  isomorphic-git checks, and `git diff --check`.

## 2026-09-04 — T35b/T35f stale-read guard

- Guarded asynchronous Log-tab and commit-detail responses against stale
  render generations and detached rows.
- Added source-level regression coverage for the delayed-response paths.

## 2026-09-04 — T35b/T35f/T37 sidebar read-model extraction

- Added `SidebarReadModel` to own plugin-lifetime history, commit-detail, and
  activity-log cache data.
- Kept rendering and Git mutations in `GitSidebarView`, with explicit model
  invalidation and independent unit coverage.

## 2026-09-04 — T29a/T35d/T35f UI and log regression fixes

- Fixed the Changes view so a single staging action cannot animate every
  checkbox.
- Removed checkbox spinner animation entirely; staging controls now only use
  disabled-state feedback during a mutation.
- Fixed duplicate Log-tab entries caused by merging live entries with their
  persisted file copies.
- Made successful-push tracking-ref updates overwrite-safe.
- Added focused regression coverage for both reported behaviors.

## 2026-09-04 — T35b/T35f operation-entry-point conformance

- Added AST-backed source checks that keep all main-plugin and sidebar Git
  mutations inside `runGitMutation`.
- Added lifecycle checks for coordinator disposal and GitManager signal
  cleanup.

## 2026-09-04 — T35b/T35f operation ownership checkpoint

- Added explicit operation lifecycle events and cancellation finalization.
- Prevented late mutation results from being reported as successful after
  cancellation or plugin unload.
- Centralized operation lifecycle logging and routed local initialization
  through the GitManager cancellation boundary.
- Regenerated and verified the production bundle; 59 Node tests and 10
  isomorphic-git checks pass.

## 2026-09-03 — T29/T35b/T35d/T36/T37 Memory Bank reconciliation

- Recorded the `e2cb6ad` reliability follow-up, including refresh invalidation,
  delete-aware refresh, cache lifetime, staging busy-state protection, live
  logs, frozen progress timers, and the already-current pull fast path.
- Corrected the current isomorphic-git record to official 1.41.9 and preserved
  1.29.0 only as historical pre-upgrade evidence.
- Added tentative T37 and a design document assessing incremental extraction
  versus a clean plugin rewrite. The current recommendation is incremental
  extraction with the existing plugin retained as the rollback baseline.

## 2026-09-02 — T29/T35 updater repair and sidebar follow-up audit

- Repaired rolling development-build detection in `910c5f5` by aligning the
  main release metadata with the updater, accepting older metadata, and using
  the selected branch head when optional commit metadata is absent.
- Recorded the remaining updater work: show commit subjects for builds and
  remove full SHAs from generated release titles without hiding builds that
  lack optional metadata.
- Recorded the remaining T29a/T35b/T35c/T30 work for compact density settings,
  shared sidebar read snapshots, tab-specific history loading, remote browsing
  without healthy local Git, and protected repository rebuilding.
- Verification for the repair passed: 10 focused updater tests, 34 full
  project tests, production build, isomorphic-git checks, and `git diff --check`.

## 2026-09-02 — T29a mockup-match follow-up

- Replaced the rough sidebar treatment with mockup-oriented composition:
  branch/status header icons, checkbox/status/path/menu Changes rows, icon
  footer actions, Commit timeline cards, and a clean Log feed.
- Preserved the existing staging, commit, pull, push, ignore, history, and
  log handlers.
- Source verification and archive checks pass. Real Obsidian screenshot
  acceptance remains pending.

## 2026-09-02 — T29a sidebar presentation implementation

- Implemented the coordinated mockup-led sidebar presentation pass across
  Changes, Commits, and Log.
- Added accessible tab, section, commit, and action semantics plus an icon-based
  refresh control while preserving existing Git handlers.
- Added shared theme-aware styling, responsive narrow-sidebar rules, stable
  content scrolling, and fixed Changes actions with bottom padding.
- Production build, archive, 29 Node tests, 10 isomorphic-git checks, and
  `git diff --check` pass. Real Obsidian visual acceptance remains pending.

## 2026-09-02 — T29a full sidebar UI redesign plan

- Recorded the decision to replace incremental sidebar styling with one
  coherent mockup-led visual redesign.
- Created T29a and the dedicated sidebar UI redesign implementation document.
- Preserved existing Git behavior and kept implementation and real Obsidian
  visual acceptance pending.

## 2026-08-18 — T29 session closeout

- Recorded the session title: `T29: Finalize contextual sidebar UX and publish
  Memory Bank closeout`.
- Confirmed commit `4292bf9` was pushed to `origin/main` after production
  build, archive, test, and diff verification.
- Recorded the next-session handoff: real Obsidian desktop/mobile acceptance
  of the three sidebar layouts.

## 2026-08-18 — T29 sidebar UX follow-up

- Recorded the approved three-tab sidebar design and added the three approved
  mockups to `memory-bank/assets/ui-mockups/`.
- Started the implementation that makes commit entry and secondary controls
  contextual, hides the Changes footer on Commits and Log, and gives Log its
  own utility menu.
- Recorded that the bulk staging behavior has been fixed in source; real
  Obsidian acceptance remains pending.
## 2026-09-03 — T29/T29a/T30/T35b/T35c/T35e/T35f

### Changed

- Made compact the only sidebar density and removed the comfortable setting.
- Unified sidebar status reads and preserved file status when branch comparison
  metadata cannot be read.
- Added updater timeouts, asset diagnostics, and stale temporary-folder cleanup.

### Fixed

- Corrected UTF-8 option handling so isomorphic-git can process `.gitignore`.
- Reduced shallow-history warning noise and retained remote commit fallback.
- Added a viewport-aware `.gitignore` editor attempt; Android keyboard overlap
  remains an unresolved acceptance issue.
## 2026-09-03 — T29/T35 maintenance diagnostics and mobile-ref follow-up

- Recorded the shipped Maintenance and Diagnostics settings, local index
  repair, backup/restore previews, faster repair scans, scoped file logging,
  metrics, lifecycle messages, and selectable result text.
- Recorded the boundary that local index repair does not replace a damaged
  repository or rebuild an existing non-empty vault from the remote.
- Recorded the unresolved mobile `typora-notes` failure where
  `refs/heads/main` cannot be resolved during the repair dry run.

## 2026-09-03 — T29, T35b, T35c, T35d, T35f, T36 session continuation

- Recorded mobile-copy Git metadata reconstruction and the official/mobile
  repository boundary.
- Recorded deletion-aware staging and bounded batch/concurrent Git operations.
- Recorded the urgent unresolved `.gitignore` enforcement regression.
- Created independent T36 documentation for an official 1.41.9 evaluation and
  possible isomorphic-git fork, including packaging and maintenance boundaries.

## 2026-09-03 — T29/T35b/T35d/T36 implementation plan

- Recorded the confirmed architecture diagnosis for first-load rendering,
  comparison state, tab cache invalidation, persistent logs, memory metrics,
  and push progress.
- Recorded `.gitignore` enforcement as the first implementation gate and the
  official 1.41.9-before-fork dependency decision.

## 2026-09-03 — T29/T35b/T35d/T36 implementation result

- Pinned official isomorphic-git 1.41.9 and fixed staging-boundary ignore
  enforcement while preserving tracked-but-ignored files.
- Implemented the sidebar loading/comparison/cache changes, persistent Log
  history, opt-in memory metrics, and honest timed push progress.
- Automated verification passed; real Obsidian desktop/mobile acceptance is
  still open.
## 2026-09-04 — T38 current product specification

- Added the implementation-agnostic current product specification covering
  the complete visible product, Settings panel, platform behaviour, and
  evidenced edge cases.
- Added a product-context index and T38 tracking record.
- Recorded the next-session handoff: create the rewrite task as the new origin
  task after product-specification review.
- No source code, UI layout, or implementation behaviour was changed.

## 2026-09-04 — T38 rewrite PRD draft

- Derived the first rewrite PRD from the current product specification.
- Recorded UI preservation, functional and platform requirements, actual
  edge-case acceptance, evidence layers, and KISS constraints.
- Deferred creation of the rewrite task and branch to the next session as the
  new origin task.
- No source code or UI layout was changed.

## 2026-09-04 — T38 UI-preserving mechanics rewrite

- Clarified the PRD so the existing Settings panel, sidebar layout, styles,
  dialogs, and updater presentation remain the baseline.
- Defined the rewrite as replacement of Git/repository mechanics and the
  result-to-UI path behind a small product-facing interface.
- Added the proven `obsidian-ai`-derived updater behaviour and safety rules to
  the rewrite requirements without copying its source structure.
