# T16: Multi-Repository Architecture

*Created: 2026-10-31 13:41:41 IST*
*Last Updated: 2026-10-31 13:50:23 IST*

**State:** implementation plan; no multi-repository feature is implemented.
**Owners:** [T16](../tasks/T16.md) core features; [T17](../tasks/T17.md) secondary features. Repository identity and switching belong to T16a; isolation accompanies every feature.

## Scope and Current Foundation

All repositories live inside the open vault. Desktop and mobile use the same
isomorphic-git and DataAdapter path. Existing functions already receive a
repository path; keep that useful boundary rather than replacing the filesystem.

Today pluginData stores one repositoryPath, remote URL, branch, and author.
RemoteOperationController and integrationProvider obtain that global target.
GitSyncView owns much repository state and filters vault events using that path.
One SecretStorage key supplies the remote token. Repository snapshots are keyed
by normalized repository path; history also depends on repository and branch.

## Proposed Minimal Model

- Registry entry: stable repository ID, display name, canonical vault-relative root, and explicit per-repository overrides/credential reference where needed.
- Persist selected repository ID separately from repository definitions. Keep author defaults global with optional repository overrides.
- Resolve an immutable operation context containing repository ID, root, adapter, selected ref, remote/upstream, and required identity/auth options when the user requests an action. Resolve secrets at execution through the captured credential reference; never log or persist credential values in operation recovery records.
- Deduplicate canonical roots. Support `.`; reject absolute paths, traversal, and ambiguous aliases after normalization, including backslash handling.
- Validate all operation file paths against the repository root, including integration inputs and `.git` indirection. Repo boundaries remain within the vault.
- Missing/moved repositories have a visible unavailable state; removing a registry entry must not delete its folder.

The exact TypeScript types and module names are implementation choices. Keep
functions and small state owners; do not introduce a generic workspace framework.

## Migration and Portability

Migrate old single-repository data to one registry entry, retaining `.` or its
existing subfolder, configured remote/branch, and author identity. Preserve the
existing token reference without exporting its value. Use a versioned, idempotent
migration and test reload/import; imports must not overwrite unrelated secrets.

Read actual Git remotes, current branch, and upstream configuration. Do not force
`origin` to match plugin settings on every operation. Explicit configuration edits
are the only writes to remotes/upstreams. Specify how legacy branch settings map
to actual Git state rather than silently checking out another branch.

## Parent and Child Repositories

A vault root repository is optional. Support sibling repositories and detect
nested roots. A temporary probe confirmed that the current backend lists child
files in parent status and stages them as ordinary files.

- Inspect overlap when registering, initializing, or cloning a repository.
- For independent child repositories, provide explicit parent exclusion handling and enforce boundaries in status, bulk stage, restore, checkout, and remote updates.
- Detect child files already tracked by the parent. Explain the overlap and require a deliberate migration; adding an ignore rule does not untrack them.
- An exclusion in the UI alone is insufficient: parent checkout/reset/merge can still touch tracked child paths. Check intersecting writes or refuse that unsafe parent operation.
- Do not automatically convert independent folders into submodules or rewrite parent history.

## Operation and State Ownership

Use a per-repository mutation coordinator shared by UI and integration tools.
Serialize writes to the same repository; overlapping roots need an exclusion
policy for intersecting writes. Global remote serialization may remain initially
if it is simpler, but it must not change captured targets.

Reads carry repository identity and generation. Reject late results after a
switch or newer refresh. Scope selections, history/ref caches, progress, activity,
and invalidation to their repository. Route vault events to affected roots and
preserve path-scoped refresh; do not rescan every repository for each note edit.

Repository switching may leave an operation running, but its target and progress
must remain visible and fixed. Confirmations identify repository, branch, remote,
and affected scope. Completion must invalidate the operation's repository, not
whichever repository is selected at that moment.

## Integration Contract

Add repository listing and explicit repository IDs to Git tool inputs/results.
For legacy callers, define and test a selected-repository fallback captured at
invocation; unknown IDs fail rather than falling back. Provider writes use the
same mutation coordinator, validation, cache invalidation, and view notifications.

## Inspection Corrections

Use backend currentBranch/resolveRef APIs instead of assuming loose refs in
`.git/refs/heads`. Existing inspection can report null HEAD for a packed branch
ref. `.git` files require discovery and vault-boundary checks before any access;
linked worktree support must be validated separately rather than inferred from
backend discovery code.

## Related Work

[T14](../tasks/T14.md) owns current modularity changes; [T15](../tasks/T15.md)
owns test infrastructure. Keep their current work intact and adapt this plan to
verified interfaces when implementation begins. See [workflows](multi-repository-git-workflows.md)
and [mobile checks](multi-repository-mobile-verification.md).
