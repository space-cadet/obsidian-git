# Git Operation and Lifecycle Notes

*Created: 2026-08-11 02:03 IST*
*Task: T35b, T35c*

## Purpose

Record the concrete repository-operation, initialization, view-refresh,
progress, and plugin-shutdown behaviour that must remain understandable and
safe.

This is an implementation record, not a required architecture for the rewrite.
The named classes and proposed module lists below describe work that was tried
or considered; they are not requirements to reproduce it.

## Current Structural Problem

The plugin exposes the same repository through auto-sync, commands, settings,
sidebar actions, and refresh timers. These paths can run concurrently, while
the Git manager also performs direct filesystem and remote mutations. Clone,
local-only, and empty-remote paths are inferred from errors rather than an
explicit state model.

## Minimum Operation Behaviour

The product needs a clear result for each Git action. Long-running actions must
stop when the user cancels them, and two conflicting mutations must not run at
the same time against the same repository. Every action must clean up its
progress and temporary state after success, failure, or cancellation.

The code may meet these needs with local guards and operation-specific cleanup.
This document does not require one global coordinator, lifecycle event stream,
operation-ID system, or named progress owner.

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

The implementation should choose the simplest explicit recovery contract that
the affected workflow needs. A marker, retained `.git` state, or protected
backup may be enough; a coordinator or operation ID is not required. Existing
`.git` must not be deleted until the replacement path has been validated and
the user can recover from a failed replacement. Visible worktree files may
still appear only during checkout unless checkout is separately instrumented.

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

## Repository State Handling

The implementation must distinguish the outcomes that affect a user action;
it does not need a named state model. At minimum, the user must be able to tell
the difference between:

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

The sidebar should keep rendering and its display state understandable. If an
asynchronous read can update a changed or detached view, that view needs a
small generation or cancellation check. Closing the view must stop timers and
discard work that should no longer update it. Unloading the plugin must stop
work that the product presents as cancelled; no host/service view-model layer
is required.

## Sidebar Read Snapshot and Remote-Only Access — 2026-09-02 / 2026-09-03

The current sidebar refresh was observed to repeat repository status reads
before rendering Changes, and tab switches repeated shared work even when only
the visible history source changed. A direct read can fix this if the problem
is still present; a shared snapshot or cache is optional.

The earlier target read path was:

```text
repository read -> immutable snapshot -> header / Changes / active tab
```

It proposed one snapshot containing branch, ahead/behind state, one status
matrix, and derived groups. It also proposed separate history reads and a
short-lived cache. These remain optional implementation choices. The required
behaviour is simply that a changed view does not show an old result and that a
refresh does not repeat an expensive read without a user-visible reason.

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
Every caller must stop timers and release progress state after success, failure,
or cancellation. A failure must never pass through the success completion
function. The cleanup can remain local to the operation.

## User-Reported Sidebar and Push Symptoms — 2026-09-03

The first-load blank, repeated tab reads, false "Up to date" status, and
session-only Log view were observed as view-read problems. A direct read or
small local refresh change should fix each one. A retained snapshot, tab cache,
or generation check is justified only when it is the smallest clear fix for
the specific failure.

The push dialog is also using the clone progress vocabulary for a push request.
Its byte counter measures the buffered response after `requestUrl` returns, not
upload progress; callback silence therefore freezes the visible phase. The
required behaviour is an honest push result and progress display. Separate
push phases, an elapsed timer, or an indeterminate transfer state are options
only when the current UI cannot explain the result without them.

## Implementation Options Considered

Earlier review notes proposed separate settings, transport, repository,
operation, and sidebar-state modules. Those names are retained here only as
history. The rewrite should create a separate module only when it makes a
specific required behaviour simpler.

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
Existing `.git` replacement protection and the direct behaviour for competing
mutations remain open; T35b is the follow-on task for that specific workflow.

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
protected repository replacement and real device workflow checks remain open.

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

This session improved several sidebar and staging paths, but it did not resolve
the broader UI backlog. Real Obsidian desktop/mobile behaviour, visual parity,
and remaining UI issues must stay separate acceptance work.

## Desktop Status Adapter Failure — 2026-09-05

The Changes view could render no files even when Git reported tracked and
untracked changes. The desktop adapter attempted `readlink` on an ordinary
file path, producing `EINVAL`; the exception caused the working-tree status
matrix to be discarded. The adapter now reads ordinary desktop files directly,
handles actual symlinks through native metadata, and skips broken ignored
symlinks without losing unrelated status rows. Status-pipeline diagnostics now
retain repository, branch, count, comparison, and filesystem error context.
