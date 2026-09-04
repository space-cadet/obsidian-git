# Clone Recovery and Progress Telemetry

*Created: 2026-08-12 13:13:05 IST*
*Last Updated: 2026-09-03 18:50:21 IST*
*Tasks: T35b, T35c, T35d*

## Purpose

Record the user-visible clone interruption and progress-display gaps found in
the current Android and desktop implementation. It also records the narrow
implementation slice added for resumable clone state and progress telemetry.

## Current Evidence

### Interrupted clone

The empty-repository path in `src/gitManager.ts` previously:

1. removes `.git` before attempting the memory-efficient clone;
2. calls `git.clone`;
3. catches clone failure and falls back to `git.fetch`;
4. writes the normal working tree only during a later `git.checkout`.

`isomorphic-git` removes its partial git directory when its clone operation
fails. Therefore an interruption before checkout can leave no visible vault
files and no resumable state.

The implementation now uses `init -> ensureRemote -> fetch -> checkout` for
fresh and shallow clone paths. It does not call `git.clone` and does not remove
`.git` before fetching. A failed or cancelled fetch therefore retains the
initialized repository and remote configuration. After fetch completes, the
plugin writes `.git/obsidian-git-sync-checkout.json` with the fetched branch
tip. If checkout is interrupted, the next explicit clone/retry validates that
marker and the local commit object, skips fetch, and resumes checkout directly.
The marker is cleared only after checkout succeeds.

The current fetch still buffers a response and pack before writing it, so this
is retryable local Git state rather than a byte-range resume of an interrupted
HTTP response. Repository detection checks the target
directory's own `.git/HEAD`, avoiding accidental inspection of the desktop
process working directory.

### Progress modal

The current native HTTP boundary receives a complete `arrayBuffer` from
Obsidian `requestUrl` before exposing it as an async iterator. The iterator's
64 KiB chunks are parser-memory protection, not network streaming.

The modal currently combines several different progress namespaces:

| Namespace | Current source | Meaning | Current state |
|-----------|----------------|---------|---------------|
| Network bytes | None during `requestUrl` | Wire bytes received | unavailable |
| Git objects | isomorphic-git `onProgress` | Objects parsed/indexed | available on some paths |
| Git messages | isomorphic-git `onMessage` or local timer | Human-readable phase text | available |
| Checked-out files | None | Files written to vault | unavailable |

The fallback fetch path now passes `onProgress`, the modal keeps object counts
separate from response bytes, and the rate calculation uses successive byte
samples. Checkout progress is supplied by isomorphic-git's `Updating workdir`
events plus temporary write-byte instrumentation in `ObsidianFsAdapter`.
Because `requestUrl` still returns a complete `arrayBuffer`, these are
response-consumption statistics after the native response arrives, not true
wire-level streaming statistics during the network wait.

## Target Progress Contract

The UI and operation coordinator should use separate optional fields:

```text
phase
message
bytesLoaded
bytesTotal
bytesPerSecond
estimatedSecondsRemaining
objectsLoaded
objectsTotal
filesWritten
filesTotal
indeterminateReason
```

Rules:

- Never format object counts as bytes.
- Show byte rate and ETA only when byte samples and a trustworthy total exist.
- Show an indeterminate transfer state when the native transport cannot stream.
- Show object counts from pack processing independently of network bytes.
- Show files written and total files only when checkout instrumentation can
  support them.
- Preserve the last valid metrics while text messages change the current phase.

### Push-specific follow-up — 2026-09-03

Push must not reuse the clone phase list. Its visible phases are connecting,
preparing upload, uploading, waiting for remote confirmation, and confirming
the branch. `requestUrl` buffers the request/response, so upload bytes remain
indeterminate unless the transport supplies a trustworthy callback. The modal
must keep a one-second elapsed timer independent of Git callbacks and retain a
successful result until the user dismisses it.

## Recovery Contract

T35b/T35c must select one supported interruption policy:

1. **Resume partial repository**: preserve `.git`, record operation metadata,
   and safely retry fetch/checkout.
2. **Protected staging**: clone/fetch into a staging area and recover it on the
   next attempt without exposing incomplete vault content.
3. **Restart-only**: clean partial state intentionally, but tell the user that
   the operation cannot resume and never imply partial progress was retained.

The implementation selects option 1 for a fresh or explicitly initialized
repository: preserve `.git` and retry fetch/checkout explicitly. A completed
fetch followed by interrupted checkout now resumes at the file checkout layer
without another network request. Protected
replacement backups, operation serialization, and a durable operation record
remain open follow-up work. A failed fetch does not claim that the worktree is
complete; visible vault files are only written during checkout.

## Acceptance Tests

- Interrupt clone during HTTP response handling, pack processing, and checkout.
- Verify the selected recovery state, cleanup, retry, and user-facing status.
- Verify closing the modal has the documented cancel/hide/continue behavior.
- Verify only one clone/fetch/checkout mutation is active at a time.
- Verify byte, object, and file counters use separate units and labels.
- Verify unavailable byte totals produce an indeterminate display rather than a
  false percentage or ETA.
- Verify fallback fetch still reports object progress.
- Verify a completed fetch followed by interrupted checkout skips fetch on the
  next retry and clears recovery metadata only after checkout succeeds.
- Verify Android and desktop behavior separately with small and large repos.
- Verify the modal labels response-consumption bytes honestly when native
  transport buffering prevents live wire telemetry.

## Ownership

- T35b: operation ownership, cancellation, recovery, retry, and modal lifecycle.
- T35c: `.git` replacement, backup, destructive cleanup, and vault-file safety.
- T35d: native transport capabilities, byte telemetry, object progress, and
  mobile evidence.
- T29: release acceptance and public-release gate after the relevant follow-up evidence
  is complete.
