# Active Context

*Last Updated: 2026-10-05 14:19:36 IST*

## Current Focus

- **T14 META** — ongoing project code quality, review, and modularity; the first
  `main.ts` extraction pass is documented, with Changes-view decomposition
  still open
- **T4, T5, T7, T8, T9, T10** — Changes, Activity, remote operations, release
  publication, progress feedback, and platform/performance verification remain
  active
- **Completed (2026-09-18)** — T11 deletion-aware staging, T12 Integration
  Provider API (read-only slice), T13 provider snapshot cache, T39b git write
  tools (stage/commit/pull/push). The integration provider is the new
  capability surface consumed by obsidian-ai.

## Current State

The source now contains multi-selection, filtering/sorting, file overflow
actions, targeted Changes reconciliation, paginated Activity and commit
history, retained remote progress/results, and a manual full-refresh policy.
Changes refreshes defer local and remote commit history until the Commits tab
is opened; the full Changes scan remains the main measured latency cost.
Activity is persisted as bounded plain text in `activity.log`; commit details
load lazily, and Pull/Clone expose an explicit Changes-needs-refresh state.
The filesystem bridge filters stale adapter paths and reuses validated stats.
The Changes panel now renders filtered changes as nested folders and files;
folder selection and selected staging actions cover only currently visible
files. The user approved the tree mockup saved at
`memory-bank/assets/changes-tree-mockup.png`. `pnpm build` passed for the tree
and integration-stage refresh updates; installed desktop/mobile and live
Obsidian acceptance remain open. Provider staging updates known paths locally
and reads only unknown paths by path, avoiding a new full Changes scan.
The rewrite is published from `main`. On 2026-09-18 the provider delivery
landed: `plugin.api.integrationProvider` exposes git.status/changed_files/
log/commit_changes plus write tools git.stage/commit/pull/push, with a shared
snapshot cache invalidated on every mutation. Deleted-file staging now routes
missing paths to `git.remove`. Verified end-to-end from obsidian-ai (17-check
smoke: deletion staging, commit hash == HEAD, cache invalidation). Remaining
work is Changes revert, renaming or removing remote filenames that mobile
cannot create, Log clear/export, cancellation only with a tested abort path,
remote edge cases, and controlled cold/warm timings in the large target vault.

The Changes panel now has a configurable background refresh delay (Off, 5,
15, 30, or 60 seconds). While its view is open but inactive, vault file events
are coalesced and only affected repository paths are checked after the quiet
period; returning to the view flushes pending paths immediately. This avoids
periodic full-vault scans. Production build passed; live Obsidian behavior has
not yet been verified.

## Current Decisions

- Tasks are organized by app component, not abstract project goals.
- Keep the task tree shallow and the implementation direct.
- Do not add edge-case machinery without a demonstrated need.
- Keep vault-wide Changes scans explicit; use known-state or targeted
  reconciliation for successful mutations and surface uncertainty visibly.
- Background refresh is event-driven and path-scoped; do not add periodic
vault-wide status scans.

The first T14 source-organization pass moved plugin-data handling, the Settings
tab, the sidebar view, remote-operation coordination, dialogs, and focused
Activity/Commits renderers out of `src/main.ts`. The plugin coordinator is now
428 lines; `src/GitSyncView.ts` remains 2,061 lines and is the next review
target. The production build and `git diff --check` passed; installed-host
behavior has not been rechecked for this refactor.
- Treat mobile-incompatible remote paths as an explicit compatibility boundary:
  skip and report them on mobile, while preserving complete checkout behavior
  on desktop.
- Provider write tools take explicit vault-relative paths only; no stage-all.
- The snapshot cache must be invalidated by every new mutation capability.

## Next Actions

1. T14: Review shared selection, refresh, and staging ownership in
   `src/GitSyncView.ts` before selecting its next extraction seam.
2. Rename or remove remote filenames that mobile cannot create.
3. Capture repeated cold/warm latency timings in the large `typora-notes` vault.
4. Keep T4 revert and T5 clear/export as the remaining UI refinements.
5. Determine whether an abortable HTTP path can support real cancellation;
   continue remote edge-case testing separately.
