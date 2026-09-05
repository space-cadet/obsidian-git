# Session: 2026-08-12 — Startup Clone Regression Fix

**Focus**: T35c: Prevent startup cloning and harden repository initialization

## Work Completed

- Made `ensureGitManager()` and passive sidebar refresh read-only.
- Reserved repository initialization and cloning for explicit Clone Remote
  actions.
- Prevented auto-sync and normal sync from contacting a remote when no local
  `.git` directory exists.
- Added a focused regression test for the missing-local-repository sync path.
- Updated the T35c task record, active context, progress log, session cache,
  and edit history.

## Verification

- Full test suite: 24 Node tests passed.
- Isomorphic-git compatibility checks: 10 passed.
- Production build, archive validation, and `git diff --check` passed.

## Remaining

- Protected backups for destructive `.git` replacement remain open.
- T35b lifecycle and operation coordination remain open.
- Android/iOS acceptance with valid credentials remains a release gate owned by
  T29/T34.

## Status

✅ CLOSED — startup clone regression fixed, documented, and ready to commit.

## Follow-up Documentation — Clone Recovery and Progress Telemetry

The user reported that interrupted cloning leaves no local files and that the
progress modal lacks live file, byte, rate, total-size, and remaining-size
statistics. A read-only source check confirmed both issues:

- The clone/fallback path can remove `.git`, `isomorphic-git` cleans partial
  clone state on failure, and visible vault files are written only during
  checkout.
- Obsidian `requestUrl` buffers the full HTTP response; the fallback fetch omits
  object progress; object counts are mislabeled as bytes; the modal rate
  calculation is zero-delta; and checkout has no file-progress callback.

Updated T35b, T35c, and T35d plus the reliability, Git HTTP, active-context,
progress, task-registry, and session-cache records. Added
`implementation-details/clone-resume-and-progress.md` with the recovery
choices, metrics contract, ownership split, and acceptance tests. No production
code changed.

## Follow-up Implementation — 2026-08-12

- Replaced the fresh and shallow clone `git.clone` path with explicit
  `init -> fetch -> checkout`, preserving initialized `.git` state after
  interruption for a later retry.
- Added cancellation-aware response iteration and checkout callbacks, plus
  separate object, response-byte, file, written-byte, rate, ETA, and phase
  displays in the progress modal.
- Corrected repository detection to inspect the manager's target directory
  rather than the desktop process working directory.
- Added focused clone-retention and adapter-write telemetry tests.

Verification: `pnpm test` passed, including the production build, Node test
suite, and 10 isomorphic-git compatibility checks. Protected replacement
backups, shared mutation coordination, genuinely streaming byte telemetry, and
Android/iOS acceptance remain open.

The follow-up now also records a completed-fetch checkout marker. A retry with
that valid local commit skips HTTP and resumes checkout; the marker is removed
only after successful checkout.

## Session Title

T35b, T35c, T35d: Implement limited clone resume and progress telemetry

## Memory Bank Closeout — 2026-08-12 13:59:20 IST

- Recorded the completed limited-resume behavior: a validated fetched commit
  allows checkout retry without another HTTP fetch.
- Recorded the updated progress modal statistics and separate transport,
  object, and checkout metrics.
- Marked the implemented T35b/T35c/T35d acceptance items complete while
  retaining open backup, coordination, streaming-transport, and device gates.
- Verification: 28 Node tests, 10 isomorphic-git checks, production build, and
  `git diff --check` passed.
