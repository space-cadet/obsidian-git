# Session: 2026-08-11 — Minimal Secure Credential Storage

**Focus**: T35a secure storage implementation under KIRSS scope

## Work Completed

- Added a small `CredentialStore` around Obsidian `app.secretStorage`.
- Raised the minimum supported Obsidian version to 1.11.4.
- Added per-vault secret IDs and one-time legacy plaintext migration after a
  successful secret-store write.
- Removed the persisted password setting and refreshed credentials before
  sync, pull, push, force-push, Test Connection, and GitHub API fallback work.
- Added explicit unsupported-host and missing-credential errors with no
  plaintext fallback.
- Updated README and security documentation.

## Verification

- Production build passes.
- Full suite passes: 23 Node tests and 10 isomorphic-git checks.
- Archive validation and `git diff --check` pass.

## Remaining

- Device acceptance, export inspection, broader lifecycle coordination, and
  protected `.git` replacement backups remain separate follow-up work.

**Status**: ✅ CLOSED
