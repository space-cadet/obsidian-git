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
and rollback remain required before a repair action is exposed.
