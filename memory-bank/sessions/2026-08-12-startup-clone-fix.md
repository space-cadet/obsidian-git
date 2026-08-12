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
