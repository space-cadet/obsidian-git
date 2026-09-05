---
source_branch: rewrite/ui-complexity-refactor
source_commit: bfe42cffb9d747f478fe13cb56d1b72a3d9af684
---

# T40 UI Rendering Lifecycle Plan

*Recorded: 2026-09-05 21:00:52 IST*
*Task: T40*

## Decision

Keep the approved Obsidian UI and replace only the update paths that discard
and recreate live UI state. Do not introduce a framework or replace the T39
backend.

## Confirmed Sources of Work

### Activity

`GitSidebarView` invalidates the Log model on every logger notification. When
Activity is visible, it refreshes the tab, rereads up to 500 persisted entries,
merges persisted and live data, empties the pane, and recreates every row.

`Logger.getEntries()` also compares each live entry with persisted entries and
may stringify structured data while deduplicating. Repeating that work during
every live update magnifies the visible delay.

### Changes and refresh fanout

`repaintStatusSnapshot()` empties and recreates the active Changes pane after
selection and mutation changes. Four vault watchers independently request a
forced refresh. Each completed status read emits an Activity entry even when
the snapshot did not change, coupling status scans to Activity reconstruction.

### Progress

The progress modal runs a one-second full render and performs the same full
render for transport and checkout updates. Statistics, phases, bars, and the
footer are rebuilt although their structure is fixed.

## Planned Refactor

1. Load Activity history on first open or explicit reload only. Deliver live
   entries to the view, batch a burst once, and insert/remove only changed rows
   while preserving the reader's position.
2. Maintain Changes rows by path. Patch selection, busy state, counts, and
   successful mutation results in place. Rebuild only for a changed filter,
   sort order, or initial snapshot. Store collapse state outside the DOM.
3. Coalesce vault events and separate a dirty status snapshot from an immediate
   full status read. Suppress routine unchanged-snapshot Activity noise.
4. Construct progress-modal rows once. Retain references and update text,
   classes, widths, and elapsed text in place.
5. Consolidate CSS override layers only after behaviour tests prove the final
   approved layout is unchanged.

## Required Evidence

- Behavioural tests cover Activity delta application, retention, reading
  position policy, Changes state preservation, and refresh coalescing.
- Source/build checks remain distinct from real Obsidian desktop and Android
  timing, scroll, focus, narrow-sidebar, and modal-resize acceptance.

## Non-Goals

- No backend replacement, Git transport change, credential change, updater
  rewrite, or visual redesign.
- No claim that a source/build pass establishes device acceptance.

## Implementation Record — 2026-09-05 21:24 IST

- The view retains Activity row elements by entry key. The first render may
  read and merge persisted history; live notifications update the retained
  model and DOM without invoking `FileLogger.readEntries()`.
- Changes retains row and section-list references. Ordinary selection and
  mutation updates patch existing rows, control counts, selection controls,
  collapse state, and the footer. Filter and sort choices remain explicit
  order-changing rebuilds.
- All four vault event types now enqueue one delayed refresh. The status
  diagnostic is emitted only for a changed snapshot, avoiding routine Activity
  work for identical scans.
- `GitProgressModal` builds statistics, phase rows, bars, and footer once,
  then changes their text, classes, width, and visibility in place.
- Source/build evidence: focused T40 checks and full `CI=true pnpm test`
  passed. Runtime Obsidian acceptance is still a separate required check.
