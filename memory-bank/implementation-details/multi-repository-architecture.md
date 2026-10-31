# T16: Multi-Repository Architecture

*Created: 2026-10-31 13:41:41 IST*
*Last Updated: 2026-10-31 15:06:54 IST*

**State:** Source implements registry selection, repository workflows, and isolation; named remotes/upstreams, merge recovery, and installed-host acceptance remain open.
**Owners:** [T16](../tasks/T16.md) core features; [T17](../tasks/T17.md) secondary features. Repository identity and switching belong to T16a; isolation accompanies every feature.

## Scope and Current Foundation

All repositories live inside the open vault. Desktop and mobile use the same
isomorphic-git and DataAdapter path. Existing functions already receive a
repository path; keep that useful boundary rather than replacing the filesystem.

The sidebar has a repository selector and add/open/clone flows. Schema v2
persists the registry and selected ID; settings project the selected entry.
Remote operations and integration calls capture repository-specific settings,
credentials, and paths when invoked. `GitSyncView` still owns repository
refresh and commit-history state. Legacy credentials retain the
`git-sync-remote-token` reference; new repository credentials use unique
SecretStorage references and token values are never serialized.

## Proposed Minimal Model

- Registry entry: stable repository ID, display name, canonical vault-relative root, remote URL/user name/branch configuration, and credential reference where needed. Schema v2 currently stores these values in `src/pluginData.ts`.
- Persist selected repository ID separately from repository definitions. Keep author defaults global with optional repository overrides.
- Resolve an immutable operation context containing repository ID, root, adapter, selected ref, remote/upstream, and required identity/auth options when the user requests an action. Resolve secrets at execution through the captured credential reference; never log or persist credential values in operation recovery records.
- Deduplicate canonical roots. Support `.`; reject absolute paths, traversal, and ambiguous aliases after normalization, including backslash handling.
- Validate all operation file paths against the repository root, including integration inputs and `.git` indirection. Repo boundaries remain within the vault.
- Missing/moved repositories have a visible unavailable state; removing a registry entry must not delete its folder.

The exact TypeScript types and module names are implementation choices. Keep
functions and small state owners; do not introduce a generic workspace framework.

## Migration and Portability

Schema-v1 and flat single-repository data migrate to one stable
`repo-legacy-default` entry, retaining `.` or its existing subfolder and the
configured remote/branch. The migrated entry points to the existing
`git-sync-remote-token` SecretStorage key; only that key reference is serialized.
Schema v2 stores the selected repository ID separately. Migration and
selected-entry projection tests pass; plugin reload/import persistence checks
remain open. Imports continue to leave SecretStorage values unchanged.

Read actual Git remotes, current branch, and upstream configuration. Do not force
`origin` to match plugin settings on every operation. Explicit configuration edits
are the only writes to remotes/upstreams. Specify how legacy branch settings map
to actual Git state rather than silently checking out another branch.

## Parent and Child Repositories

A vault root repository is optional. Sibling repositories have independent
status, index, history, and mutation queues. Parent/child Git roots are rejected
when registering, initializing, or cloning. The filesystem bridge hides child
Git directories from parent scans and blocks paths that cross into a nested
repository; remote writes preflight local and fetched tree paths.

- Inspect overlap when registering, initializing, or cloning a repository.
- Parent status/stage boundary and remote path preflight now have focused tests.
- Detect child files already tracked by the parent. Explain the overlap and require a deliberate migration; adding an ignore rule does not untrack them.
- An exclusion in the UI alone is insufficient: parent checkout/reset/merge can still touch tracked child paths. Check intersecting writes or refuse that unsafe parent operation.
- Do not automatically convert independent folders into submodules or rewrite parent history.

## Operation and State Ownership

Use the per-repository mutation coordinator shared by UI and integration tools.
It serializes writes to the same repository, blocks overlapping roots, and
allows sibling repositories to proceed independently. Remote operations capture
their target before entering the remote queue and invalidate that repository.

Reads carry repository identity and generation. Reject late results after a
switch or newer refresh. Scope selections, history/ref caches, progress, activity,
and invalidation to their repository. Route vault events to affected roots and
preserve path-scoped refresh; do not rescan every repository for each note edit.

Repository switching may leave an operation running, but its target and progress
must remain visible and fixed. Confirmations identify repository, branch, remote,
and affected scope. Completion must invalidate the operation's repository, not
whichever repository is selected at that moment.

## Integration Contract

The provider lists repositories and accepts explicit repository IDs on Git
tools. Omitted IDs capture the selected repository at call start; unknown IDs
fail. Provider writes use the shared mutation coordinator, path validation,
snapshot invalidation, and repository-filtered view notifications. Local
provider targeting has a regression test; remote transport behavior is not yet
covered by automated tests.

## Inspection Corrections

Use backend currentBranch/resolveRef APIs instead of assuming loose refs in
`.git/refs/heads`. Existing inspection can report null HEAD for a packed branch
ref. `.git` files require discovery and vault-boundary checks before any access;
linked worktree support must be validated separately rather than inferred from
backend discovery code.

## Related Work

[T14](../tasks/T14.md) owns code review and extraction guardrails. Its history
controller work is integrated with T16c, while Changes and refresh extraction
follows the needs of implemented features. [T15](../tasks/T15.md) owns the
shared test runner and CI gate; T16/T17 add focused tests beside each feature.
See [workflows](multi-repository-git-workflows.md) and [mobile
checks](multi-repository-mobile-verification.md).
