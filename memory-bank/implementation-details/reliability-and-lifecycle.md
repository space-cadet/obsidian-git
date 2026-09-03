# Reliability and Lifecycle Architecture

*Created: 2026-08-11 02:03 IST*
*Task: T35b, T35c*

## Purpose

Define safe ownership of repository operations, initialization state, view
refreshes, progress UI, and plugin shutdown.

## Current Structural Problem

The plugin exposes the same repository through auto-sync, commands, settings,
sidebar actions, and refresh timers. These paths can run concurrently, while
the Git manager also performs direct filesystem and remote mutations. Clone,
local-only, and empty-remote paths are inferred from errors rather than an
explicit state model.

## Operation Coordinator

All mutating operations should pass through one coordinator:

```text
request -> coordinator -> one active operation -> result/error -> refresh
                         -> cancellation/unload boundary
```

The coordinator must serialize at least clone, pull, fetch, checkout, stage,
commit, push, force-push, and full sync. Read-only status and history requests
must either use a consistent snapshot or be invalidated when a mutation
completes.

Each operation should have:

- an operation ID;
- a cancellation or invalidation signal;
- a progress owner;
- a single success/error/finally cleanup path;
- a safe user-facing error classification.

## Clone Recovery Boundary — 2026-08-12

The current clone behavior is not resumable. The no-local-commit path removes
`.git`, tries `git.clone`, and falls back to `git.fetch` plus
`git.checkout`. The fallback does not write normal vault files until checkout
begins. In addition, isomorphic-git removes its partial git directory when its
clone operation fails. An interruption can therefore leave no visible files
and no state that the next attempt can continue from.

The implementation must choose and document one explicit contract:

- preserve a partial `.git` state and resume/retry it safely;
- retain a protected staging repository and recover it on the next attempt; or
- deliberately discard partial state, but tell the user that the operation is
  restart-only and never present the result as resumable.

The preferred direction is a coordinator-owned recovery state with an
operation ID, protected local state, explicit retry/resume, and no deletion of
an existing `.git` until a validated replacement and rollback boundary exist.
Visible worktree files may still appear only during checkout unless checkout
is separately instrumented for incremental writes.

The progress modal's close control must also be assigned explicit semantics.
Closing the surface currently only removes its DOM content; it does not cancel
the network request or Git operation. T35b owns this lifecycle contract, while
T35c owns backup and destructive replacement rules.

## Clone Recovery Implementation Slice — 2026-08-12

Fresh and shallow clone now use an explicit init/fetch/checkout sequence. The
operation preserves initialized `.git` state after a failed or cancelled fetch,
and the progress modal's close signal is checked by the HTTP response iterator,
fetch callbacks, and checkout callbacks. This establishes a bounded retry
boundary but does not yet serialize all mutating entry points or provide
durable operation metadata.

## Repository State Model

The implementation should distinguish these states rather than treating every
initialization error as an empty repository:

- `NoLocalRepository`
- `LocalOnly`
- `RemoteConfigured`
- `Cloning`
- `Ready`
- `AuthenticationFailed`
- `RemoteDenied`
- `EmptyRemote`
- `Conflict`
- `OperationFailed`

Only `EmptyRemote` should permit an intentional local initialization fallback.
Existing `.git` state must not be deleted until a replacement has been
validated and a rollback path exists.

## View and Timer Ownership

The sidebar owns rendering only. It should request a view model from a host or
service and discard responses whose generation ID is no longer current. Closing
the view must stop timers and invalidate pending renders. Unloading the plugin
must invalidate all repository operations and close progress surfaces.

## Sidebar Read Snapshot and Remote-Only Access — 2026-09-02 / 2026-09-03

The current sidebar refresh performs repeated repository status reads before
rendering Changes, and tab switches repeat that shared work even when only the
visible history source changes. The target read path is:

```text
repository read -> immutable snapshot -> header / Changes / active tab
```

The snapshot should contain the current branch, ahead/behind state, one status
matrix, and derived staged/detailed groups. Commits and Log should load their
own data without recalculating working-tree status. Local/Remote history should
use a short-lived session cache and invalidate it after a repository mutation.
Every asynchronous render must check a view generation or cancellation signal
before updating the DOM.

The source implementation now derives the header, staged count, and Changes
rows from one status matrix and invalidates stale refresh generations. If
branch comparison fails but the working-tree scan succeeds, file status is
still rendered and the header reports unavailable comparison metadata.

Remote history is an independent read capability. A configured reachable remote
must be browseable through the remote/API path even when local Git is missing or
unhealthy. Repository existence checks must therefore be separated from
repository health checks.

## Damaged Repository Rebuild — 2026-09-02

Repairing a damaged `.git` directory must be an explicit, recoverable action.
The implementation should construct temporary Git state from the configured
remote, compare its tree with current vault files, and present local-only,
remote-only, and conflicting paths before any replacement. Existing `.git`
state should be retained as a protected backup until the replacement has been
validated. Vault files must not be overwritten as an implicit consequence of
opening the sidebar or browsing remote history.

## Progress Contract

Progress helpers must expose separate `complete()` and `fail(error)` paths.
Every caller must use a `finally` block to stop timers and release the progress
owner. A failure must never pass through the success completion function.

## User-Reported Sidebar and Push Symptoms — 2026-09-03

The first-load blank, repeated tab reads, false "Up to date" status, and
session-only Log view all come from view reads being owned by a full DOM rebuild
instead of a retained immutable view model. The target is one shared repository
snapshot plus tab-specific caches, explicit loading/error states, and generation
checks before any render.

The push dialog is also using the clone progress vocabulary for a push request.
Its byte counter measures the buffered response after `requestUrl` returns, not
upload progress; callback silence therefore freezes the visible phase. The
target is an operation-specific push contract, an independent elapsed timer,
indeterminate transfer state when native streaming is unavailable, and a
user-dismissed success state.

## Target Service Boundaries

- `SettingsStore`: validated settings and secret references.
- `RemoteTransport`: Git smart HTTP, retry, timeout, and safe error mapping.
- `RepositoryService`: local Git state and Git operations.
- `OperationCoordinator`: mutation serialization and cancellation.
- `GitSidebarViewModel`: immutable state for the view.

## Current Source Audit — 2026-08-11

- Fresh-vault clone is currently unreachable: `src/main.ts:326-335` returns
  before constructing a manager when `.git` is absent, while the sidebar Clone
  Remote actions call `syncVault()` (`src/views/GitSidebarView.ts:403-416,
  449-462`).
- `src/gitManager.ts:396-419` converts every clone error into local
  initialization, so authentication, permission, invalid URL, and network
  failures are not distinguished from an empty remote.
- `src/gitManager.ts:728-738` removes `.git` before clone in the no-local-commit
  path without protecting untracked/staged vault files or retaining a backup.
- `src/main.ts:366-370` and the independent operation entry points have no
  shared state precondition or in-flight operation guard.

The first T35c slice classifies clone failures before deciding whether local
initialization is allowed. The August 12 startup fix makes manager creation and
sidebar refresh read-only: only an explicit Clone Remote action may call
`initializeRepo()`, and normal sync refuses to run without a local repository.
Existing `.git` replacement protection and the shared operation coordinator
remain open; T35b is still the follow-on task for coordinating concurrent
mutations.

## Related Tasks

- T29: release and mobile acceptance boundary
- T34/T34a: authentication boundary
- T35b: coordination and lifecycle
- T35c: initialization and destructive-operation safety
- T35d: mobile/remote transport and transfer telemetry
- `implementation-details/clone-resume-and-progress.md`

## Repository Repair Status — 2026-09-03

The session did not implement repository replacement. Health checks, protected
backups, temporary reconstruction, conflict comparison, explicit confirmation,
and rollback remain required before a repository-replacement action is exposed.

## Maintenance Action and Ref-Recovery Status — 2026-09-03

The Maintenance settings now expose local index repair and related backup and
comparison previews. Maintenance operations log their lifecycle and return
selectable result text, but this does not change the repository-replacement
boundary above.

On mobile, the existing non-empty `typora-notes` repository fails before the
index scan when `refs/heads/main` cannot be resolved. The next recovery step is
read-only inspection of `HEAD`, local refs, remote-tracking refs, and adapter
visibility before any replacement or checkout is attempted.

## Session Continuation — 2026-09-03

The mobile-copy repository was repaired from the official working repository
without modifying the official repository. This does not close the separate
mobile ref-visibility investigation. The next session must preserve the vault
and existing `.git` state while diagnosing the device-side reads.

Bulk staging now reduces index-write overhead through bounded batches, but the
broader mutation coordinator and bulk unstage/reset/remove contract remain
open. Ignore-rule enforcement must be applied consistently before any automatic
or caller-supplied staging operation.

## Operation Ownership Checkpoint — 2026-09-04

`OperationCoordinator` now owns admission, cancellation, terminal outcome, and
idle cleanup for admitted Git mutations. It emits one lifecycle sequence per
operation, rejects a result that arrives after cancellation or unload, and
isolates lifecycle observers from the operation result.

`GitSyncPlugin` subscribes to that lifecycle for plugin-scoped operation logs.
The existing `runGitMutation()` path remains the shared manager/signal adapter
used by commands, sidebar actions, settings maintenance, manual sync, and
auto-sync. Local repository initialization now goes through `GitManager`, so
it cannot bypass the operation signal.

Focused lifecycle tests cover overlap rejection, cancellation, disposal,
late-success rejection, terminal cleanup, and observer failures. This is a
source-level checkpoint, not proof of real Obsidian desktop/mobile behavior;
protected repository replacement and full device conformance remain open.

## Sidebar Read-Model Checkpoint — 2026-09-04

`SidebarReadModel` now owns the plugin-lifetime cache for local history, remote
history, commit details, and activity-log entries. History is keyed by the
repository URL and branch; log and history invalidation are explicit methods.
`GitSidebarView` keeps DOM rendering, tab state, mutation callbacks, and
generation checks, so the extraction does not create a second UI owner or move
Git operations into a passive data module.

The model is covered without Obsidian DOM dependencies. The view integration is
source/build verified; real desktop/mobile freshness and visual behavior remain
runtime evidence gaps.

## Stale Read Guard Checkpoint — 2026-09-04

The sidebar now passes the current render generation into Log-tab and
commit-detail reads. After asynchronous file, Git, or GitHub reads complete,
the view checks both the generation and, for commit details, row attachment
before updating cache or DOM. This keeps a delayed response from a prior tab
or detached leaf from becoming visible state.

## Sidebar History and Staging Follow-up — 2026-09-04

The direct single-file staging path now uses the index's tracked-path list and
a targeted worktree stat. It no longer computes a full working-tree
`statusMatrix()` before every checkbox action. Tracked deletions still use
`git.remove()`, while untracked paths still pass through the `.gitignore`
policy check. Bulk staging intentionally keeps its shared snapshot and final
verification because it operates on a caller-supplied set of paths.

The Log view reads persisted entries through `FileLogger`, merges them through
the shared `Logger`, and now renders the entire bounded retained set rather
than an additional newest-50 display limit. The Local/Remote commit-source
buttons are sticky within `.git-sidebar-content`; they remain controls while
the selected history list scrolls.

Single-file staging now has one completion path in the view: the mutation
finishes, the known staged/unstaged arrays are updated, and the Changes DOM is
repainted immediately. It does not trigger a second full status read merely to
show a result Git has already returned. The next ordinary refresh remains the
authoritative reconciliation path.

Bulk staging follows the same completion rule. `addAll()` supplies the files
that actually reached the index, and `unstageAll()` now supplies successful and
failed paths. The view moves only successful paths before repainting, so a
partial bulk operation stays visible and honest without a second full scan.

## Session Closeout — 2026-09-04

This session improved several sidebar lifecycle and staging paths, but it did
not resolve the broader UI backlog. Real Obsidian desktop/mobile behavior,
visual parity, and remaining UI issues must stay separate acceptance work.
