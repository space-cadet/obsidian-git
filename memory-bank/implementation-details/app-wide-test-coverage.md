# T15: App-Wide Test Coverage

*Last Updated: 2026-10-31 14:07:57 IST*

This document defines a focused testing plan for the main Obsidian Git Sync
workflows. It follows the project guidance to test feature behavior through
small adapters, use temporary repositories, and keep installed-host evidence
separate from builds and automated tests.

## Current Baseline

- `tests/change-selection.test.cjs` and
  `tests/change-list-state.test.cjs` contain eight Node built-in tests for
  selection/range behavior and Changes snapshot transformations.
- `pnpm test` runs those tests and then `pnpm run build`.
- `.github/workflows/build.yml` currently runs `pnpm run build` directly; CI
  does not run the test command before artifact checks or development releases.
- No test currently exercises Obsidian UI rendering, repository operations,
  remote operations, plugin lifecycle/persistence, integration-provider calls,
  or updater installation behavior.

## Testing Boundaries

- Each feature should own focused behavior tests. Keep Obsidian APIs, filesystem
  access, HTTP transport, and Git operations behind the existing or small test
  adapters where practical.
- Use the installed TypeScript dependency and Node's built-in test runner for
  unit tests. Add another test dependency only when a concrete behavior cannot
  be covered with the current tools.
- Use an isolated temporary vault/repository for local Git integration tests;
  never rely on the developer's active vault or remote account.
- Test the workflows users perform. Use T10 for a small supported-platform
  acceptance set instead of building a large compatibility matrix.
- Record unit, integration, build, CI artifact, release, install, and host
  acceptance results as separate evidence.

## Coverage Layers

### 1. Pure Logic

Add focused tests for:

- `src/pluginData.ts`: defaults, old-format migration, setting normalization,
  Activity line parsing/serialization, bounded Activity history, and export data
  that excludes remote credentials.
- `src/repository.ts`: repository-path validation and any status/path transforms
  that can be tested without filesystem calls.
- `src/operationDiagnostics.ts` and `src/dateFormatting.ts`: elapsed-time,
  nested-error, and timestamp output for representative inputs.
- `src/ChangeSelection.ts` and `src/ChangeListState.ts`: retain the current
  eight regression tests and extend only when new behavior is added.
- Remote/updater result-normalization helpers, if separated from host calls.

### 2. Local Repository Operations

Use an isolated temporary repository and a `DataAdapter` test implementation
to cover:

- Repository discovery, status reads, staged/uncommitted status, and path
  validation.
- Single and bulk stage/unstage, including deleted-file staging through
  `git.remove` and unknown-path handling.
- Commit creation with configured author identity, local history reads, and
  changed-file details.
- `.gitignore` updates and path-scoped refresh behavior.
- Snapshot caching and invalidation after every repository mutation.
- The end-to-end local sequence: create/edit file, stage, commit, then observe a
  clean working tree.

### 3. Remote and Integration Provider

Use a fake Obsidian HTTP request bridge and deterministic credentials; where the
Git flow itself matters, use a local bare remote. Cover:

- Connection test, fetch, fast-forward pull, push, clone, Force Pull, and Force
  Push success and representative failure results.
- Progress/result callbacks, operation serialization, configured commit
  identity, and credential handling without exposing secrets in Activity.
- Mobile checkout filtering for unsupported filenames while preserving desktop
  checkout behavior.
- Integration-provider read/write calls and repository snapshot invalidation
  after stage, commit, pull, and push.

### 4. Plugin and UI Workflows

Test pure plugin-data/settings behavior automatically. For behavior requiring
Obsidian workspace, vault, modal, or view APIs, use focused host stubs only when
they remain simpler than the behavior under test. Keep these user workflows in
the installed-host acceptance set:

- Plugin load/reload and settings persistence, including repository
  configuration and SecretStorage-backed credentials.
- Open Changes, observe a vault edit, stage/unstage, commit, refresh, and confirm
  clean state; include one selection/filter/folder case.
- Open Activity and Commits, verify persisted Activity and lazy history details.
- Run a remote operation and verify confirmation, progress, final result, and
  the required Changes refresh state.
- Verify updater discovery/install/reload and rollback behavior where the
  release channel supports it.

## CI and Platform Acceptance

- Make the CI build job run `pnpm test` before its existing generated-artifact
  checks. Keep artifact upload and development-release steps dependent on that
  successful job.
- T10 remains the owner of installed desktop, Android, and iOS evidence.
  Record tested host identity, install/reload result, workflow steps, and any
  platform-specific failure. Do not infer these results from unit tests or a
  successful bundle build.
- Follow T10's KISS boundary: cover the core workflow and remote behavior each
  supported host actually uses; add more platform cases when a concrete
  difference requires them.

## Related Memory Bank Records

- `memory-bank/systemPatterns.md`: feature-owned tests and adapter boundaries.
- `memory-bank/techContext.md`: focused tests, temporary repositories, builds,
  and real Obsidian acceptance.
- `memory-bank/tasks/T10.md` and
  `memory-bank/implementation-details/platform-verification.md`: supported-host
  acceptance and evidence boundaries.
- `memory-bank/tasks/T14.md` and
  `memory-bank/implementation-details/code-quality-modularity.md`: separate
  test/build/host evidence and current source ownership.
- `memory-bank/implementation-details/changes-panel.md`,
  `remote-sync-authentication.md`, `settings-panel.md`, `activity-logging.md`,
  `commits-history.md`, `progress-errors-dialogs.md`, `updater-release.md`, and
  `integration-provider.md`: feature behaviors to cover.
