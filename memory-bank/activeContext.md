# Active Context

*Last Updated: 2026-10-31 15:26:08 IST*

## Current Focus

- **T16** — source now supports repository registry/selection, add/open/init,
  clone, local operations/history, per-repository settings/credentials, captured
  remote/provider targets, and mutation coordination. Named remotes, merge
  recovery, full desktop workflow, and mobile acceptance remain open; desktop
  install/reload and UI smoke are recorded. Settings now labels the vault root
  consistently with the sidebar.
- **T17** — local branch list/create/switch and restore from index are in source
  with focused tests. Tags, branch rename/delete/tracking, and restore from a
  chosen commit remain open.
- **T14/T15** — cross-cutting support: T14 review/extractions follow feature
  seams; T15 owns the shared test runner and CI gate
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

T16 source now includes a schema-v2 repository registry, sidebar selector,
add/open/initialize and clone flows, selected-repository settings, per-repository
SecretStorage references, local branch controls, and selected index restore.
Local Git operations and provider calls carry explicit roots; remote requests
capture repository-specific settings and credentials. Same-root writes
serialize, overlapping roots are blocked, and sibling repositories can mutate
independently. The parent filesystem bridge excludes nested Git roots and
push/pull preflight paths before changing the parent checkout.

`pnpm test` passed 25 tests and the production build on 2026-10-31. Coverage
includes two independent local repositories, provider repository IDs, index
restore, local branch switching, nested boundaries, packed refs, path safety,
and mutation coordination. The current working-tree build was installed into
the open `typora-notes` vault and Obsidian 1.14.5 reloaded. The plugin loaded its
schema-v2 registry; the Vault root selector, Add/Clone controls, folder picker,
clone form, and branch manager rendered. No repository, branch, or Git state was
changed, so this is UI smoke rather than multi-repository workflow acceptance.
The follow-up Settings build now displays “Vault root” instead of “.”; the
updated label was confirmed after reload. The 25-test suite was not rerun for
this presentation-only change; `pnpm run build` passed.
The active vault's root is already a repository, so parent/child protection
prevents adding a nested test repository there. Named remotes/upstreams, T16e
merge recovery, tags, full branch management, commit-based restore, remote
tests, full desktop workflow, Android/iOS acceptance, and T14 history extraction
remain open.

## Current Decisions

- Tasks are organized by app component, not abstract project goals.
- Keep the task tree shallow and the implementation direct.
- Do not add edge-case machinery without a demonstrated need.
- Keep vault-wide Changes scans explicit; use known-state or targeted
  reconciliation for successful mutations and surface uncertainty visibly.
- Background refresh is event-driven and path-scoped; do not add periodic
vault-wide status scans.
- T14 history extraction belongs with T16c; Changes and refresh extractions
  follow the feature seams that require them.
- T15 feature tests belong beside T16/T17 features; shared tooling, CI, and
  evidence ownership remain in T15.

The first T14 source-organization pass moved plugin-data handling, the Settings
tab, the sidebar view, remote-operation coordination, dialogs, and focused
Activity/Commits renderers out of `src/main.ts`. The 2026-10-31 review extracted
selection and Changes snapshot helpers. This T16/T17 pass added canonical
repository paths and a shared mutation coordinator; `GitSyncView` still owns
history state, so T14's history-controller extraction remains open. All 25
tests and the production build passed; a follow-up Settings label fix also
passed `pnpm run build`. The installed desktop UI smoke is recorded under T10;
full repository workflow and mobile acceptance remain open.
- Treat mobile-incompatible remote paths as an explicit compatibility boundary:
  skip and report them on mobile, while preserving complete checkout behavior
  on desktop.
- Provider write tools take explicit vault-relative paths only; no stage-all.
- The snapshot cache must be invalidated by every new mutation capability.

## Next Actions

1. T16d/e: add named remote/upstream controls and scoped merge/conflict recovery
   with focused remote and recovery tests.
2. T16b/T17: add remote default-branch/shallow clone handling, tags, branch
   rename/delete/tracking, and restore from a chosen commit as capacity allows.
3. T16c/T14: extract history loading/cache/paging behind a repository-scoped
   controller and test late results across repository/ref changes.
4. Complete desktop multi-repository workflow acceptance in a safe vault
   without a vault-root repository; record Android and iOS separately under
   T10.
5. Keep cancellation and large-vault timing open until a concrete acceptance
   workflow is available.

## T16 Planning — 2026-10-31 13:41:41 IST

- [T16](tasks/T16.md) owns the vault-only, fully mobile multi-repository Git interface. Architecture, workflow/backend limits, and mobile verification are linked from the task.
- Source implementation covers repository selection, initialization, clone,
  local Git operations, repository-scoped remote/provider contexts, and core
  boundaries; advanced remote/merge features and device acceptance remain open.

## T16/T17 Feature Split — 2026-10-31 13:50:23 IST

- T16 is the high-priority core: repository management, clone, changes/commits/history, remote sync, merging/conflicts.
- [T17](tasks/T17.md) is lower priority: local branch management and index-based selected restore have partial source implementations; tags and remaining branch/restore work are open.
- T14 review/extraction and T15 feature tests are integrated with T16/T17; T15 retains the shared test harness, CI gate, and evidence rules.
