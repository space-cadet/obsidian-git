# Component Map

The task registry follows app components. The build order begins with the
visible shell and Settings so the product has a visual anchor immediately.

1. T1 UI shell
2. T2 Settings panel
3. T3 Vault and local repository
4. T4 Changes panel
5. T5 Activity and logging
6. T6 Commits and history
7. T7 Remote sync and authentication
8. T8 Progress, errors, and dialogs
9. T9 Updater and release
10. T10 Platform integration and verification

Each component owns its small state, operations, UI, and focused checks.

## Current implementation status

- T1 and T2: sidebar shell, settings tab, sidebar Settings entry point, and
  versioned plugin data export/import are implemented.
- T3: read-only local repository discovery and stale-path-safe filesystem
  bridging are implemented; initialization remains pending.
- T4: local Changes list, multi-selection, filtering/sorting, overflow actions,
  stage/unstage, commit controls, targeted reconciliation, and
  render-preserving updates are implemented; revert remains planned.
- T5: plain-text bounded Activity persistence, selectable paginated Log output,
  timestamps, severity, and phase metrics are implemented; clear/export remain
  pending.
- T6: local and fetched remote commit history, lazy details, independent
  pagination, changed-file display, and comparison status are complete.
- T7: remote connection testing, SecretStorage-backed credentials, Fetch,
  fast-forward-only Pull, Push, Clone, Force Pull, and Force Push are
  implemented and user-verified; mobile checkout filtering and edge-case
  handling remain bounded follow-ups.
- T8: progress, retained completion/failure modals, remote result details,
  nested error diagnostics, and mobile output/Changes refresh polish are
  implemented; cancellation remains deferred until a real abort path exists.
- T9: updater, rolling branch-release ordering, and main development-build
  publication are implemented; real-host installation remains pending.
- T10: local, GitHub, and user-installed pushed-build evidence exists; platform-
  specific desktop, Android, and iOS acceptance remains to be recorded.

The from-scratch rewrite is the current `main` line at `f67860e`. The prior
main line is preserved as `main-before-kiss-restart`; the old rewrite branch is
no longer needed as a separate delivery branch.

Latency evidence and the manual full-refresh policy are recorded in
`implementation-details/latency-benchmarking.md`; controlled large-vault
cold/warm timings remain open.
Dependencies are added only when a component cannot function without them.

## Cross-Cutting Code Quality and Modularity (T14)

The plugin composition and module ownership map is maintained in
[`code-quality-modularity.md`](code-quality-modularity.md). The first extraction
reduced `src/main.ts` to plugin coordination and moved Settings/data, view,
remote operations, dialogs, and Activity/Commits presentation into focused
modules. Selected paths and range anchors live in `src/ChangeSelection.ts`,
while pure Changes snapshot updates live in `src/ChangeListState.ts`. The
`GitSyncView` ownership review is complete. Commit-history extraction is
scheduled with T16c; Changes presentation and refresh extraction will follow
T16/T17 feature needs. See `code-quality-modularity.md` for the staged plan.

## Planned Mobile Multi-Repository Interface (T16)

*Added: 2026-10-31 13:41:41 IST*

[T16](../tasks/T16.md) adds multiple repositories within vault folders using
the existing mobile JavaScript Git backend. The schema-v2 registry and
selected ID live in `src/pluginData.ts`. Source now includes selector/add/open/
initialize/clone controls, per-repository settings and credentials, local
branch controls, selected index restore, captured remote/provider contexts,
and write coordination. Named remotes/upstreams, merge conflict recovery,
tags, full T17 branch/restore scope, and installed-host acceptance remain open.

- [Repository identity, boundaries, migration, and operation ownership](multi-repository-architecture.md)
- [Git workflows and backend capability limits](multi-repository-git-workflows.md)
- [Mobile verification and acceptance](multi-repository-mobile-verification.md)

### Feature ownership update — 2026-10-31 13:50:23 IST

[T16](../tasks/T16.md) owns core repository management, clone, changes/history,
sync, and merging/conflicts. [T17](../tasks/T17.md) owns secondary branch/tag
management and selected-file restore. Feature-specific tests land with these
features under the shared T15 runner/CI gate. T14 extraction work follows the
repository-aware seams needed by each feature.

### Source implementation update — 2026-10-31 15:06:54 IST

`pnpm test` passed 25 tests and the production build. Simulated-adapter cases
cover two-repository local isolation, integration-provider IDs, local branch
switching, index restore, nested boundaries, packed refs, path safety, and
mutation coordination. The running Obsidian 1.14.5 host still has the earlier
plugin build, so the new repository controls have not received visual acceptance.
