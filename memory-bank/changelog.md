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
