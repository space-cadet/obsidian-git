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
