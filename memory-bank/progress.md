# Project Progress

*Last Updated: 2026-08-12 13:59:20 IST*

## Completed Phases

### Phase 1: Core Git Integration (T1) ✅
- GitHttpClient using `requestUrl`
- GitManager with clone, pull, push, add, commit, status
- Binary pack file handling via ArrayBuffer
- Basic Auth for GitHub/GitLab

### Phase 2: Plugin UI & Commands (T2) ✅
- Ribbon icon for manual sync
- Status bar showing current operation
- Settings tab with repo config, auth, auto-sync
- Commands: sync, pull, push, status, test-compatibility

### Phase 3: Auto-sync & Background (T4) ✅
- Configurable interval (minutes)
- Cleanup on plugin unload
- Date placeholder in commit message

### Phase 4: Error Handling & Logging (T5) ✅
- Replaced winston with simple Logger
- No external dependencies
- Structured logging with component prefixes

### Phase 5: Mobile Compatibility (T3) ✅
- Replaced winston (no more `require("buffer")`)
- Bundled `buffer` and `path` npm packages into main.js
- Banner stub ensures `process.cwd` always exists
- `globalThis.Buffer` set from bundled module at end of bundle
- **Tested and working on mobile device!**

## Pending

- README and user documentation
- Conflict resolution UI
- SSH key authentication
- Plugin store submission

## Active: Remote Authentication (T34)

- T34 is intentionally separate from T29 release work.
- The Settings Test Connection operation now checks a remote read-only Git ref
  advertisement without needing a local repository, cloning, or initializing
  the vault.
- Android validation confirmed the updated dev artifact reaches GitHub. The
  currently supplied token was rejected with HTTP 401 by GitHub itself; its
  value was not retained and must be revoked.
- T34a will add safe diagnostics for token validity, repository access, and
  smart-HTTP transport. T34b device flow and T34c device acceptance remain
  planned.

## Active: Reliability, Security, and Architecture Hardening (T35)

- The August 11 architecture review is recorded as T35 with child tasks
  T35a-T35f. The read-only T35a/T35c source audit is complete.
- T35a covers credential storage, redaction, and automatic staging exclusions.
- T35b covers operation serialization, cancellation, view refreshes, and
  progress lifecycle.
- T35c covers clone, local-only, empty-remote, and destructive replacement
  behavior.
- T35d covers native transport consistency, response buffering, pack-index
  limitations, and real-device mobile evidence.
- T35e covers updater checksums, release identity, rollback, and artifact
  consistency.
- T35f covers CI test execution, missing integration coverage, documentation,
  and generated-artifact drift.
- T35a/T35c have a first narrow implementation slice; SecretStorage migration,
  backup protection, lifecycle coordination, and device acceptance remain open.

### T35a/T35c First KIRSS Implementation Slice (2026-08-11)

- Added central redaction for retained logger entries, console output, Notices,
  and exported log data.
- Added URL normalization/embedded-credential rejection and automatic staging
  exclusions for the plugin-owned `.obsidian/plugins/obsidian-git-sync/` path.
- Added explicit repository error classification and local-only initialization;
  clone fallback now occurs only for a classified empty remote.
- Added focused regression coverage. Full verification passes: 19 Node tests,
  10 isomorphic-git checks, production build, archive validation, and
  `git diff --check`.
- Remaining T35a/T35c work: raw UI error-path cleanup, protected replacement
  backups, mobile/desktop acceptance, and fresh-vault/clone integration
  coverage.

### T35a SecretStorage Implementation (2026-08-11)

- Added a minimal `CredentialStore` around Obsidian `app.secretStorage`.
- Raised the minimum Obsidian version to 1.11.4 and added an explicit
  unsupported-host policy with no plaintext fallback.
- Added one-time legacy password migration, per-vault secret IDs, secure input
  handling, and credential refresh before remote operations.
- Added focused credential-store tests. Remaining work is mobile/desktop
  acceptance, export inspection, and broader lifecycle hardening.

### T35c Startup Clone Regression Fix (2026-08-12)

- Made manager creation and passive sidebar refresh read-only; loading the
  plugin no longer starts a clone on a fresh vault.
- Restricted repository initialization and cloning to explicit Clone Remote
  actions. Normal sync and auto-sync now require an existing local `.git`
  directory.
- Added regression coverage proving normal sync does not contact a remote when
  no local repository exists.
- Verification passes: 24 Node tests, 10 isomorphic-git checks, production
  build, archive validation, and `git diff --check`.
- Remaining T35c gates are protected `.git` replacement backups, lifecycle
  coordination, and real-device acceptance.

### T35b/T35d Clone Recovery and Progress Audit (2026-08-12, before implementation)

- Recorded that interrupted clone is currently restart-only: the clone path can
  remove `.git`, isomorphic-git cleans partial clone state on failure, and the
  fallback writes visible vault files only during checkout.
- Recorded that the current modal cannot provide trustworthy terminal-style
  byte totals, transfer rates, ETAs, or file counts. `requestUrl` buffers the
  full response, fallback fetch omits object progress, object counts are
  mislabeled as bytes, and the rate calculation is zero-delta.
- Added the separate `clone-resume-and-progress.md` design record with the
  recovery choices, progress-field contract, ownership split, and acceptance
  tests.
- Implemented explicit init/fetch/checkout clone recovery, cancellation-aware
  transport consumption, separate object/byte/file metrics, and the requested
  statistics modal layout. A failed clone now retains initialized `.git` state
  for retry.
- Added checkout-level resume metadata: when fetch has completed, a retry can
  skip HTTP entirely and resume checkout from the validated local commit.
- `requestUrl` still buffers the complete response, so byte rate/ETA are
  response-consumption metrics rather than live wire-level metrics. Protected
  replacement backups, operation serialization, and real-device acceptance
  remain open under T35b/T35c/T35d.
- Verification passes: production build, full Node test suite, and 10
  isomorphic-git compatibility checks.

### T35a/T35c Read-only Audit (2026-08-11)

- Confirmed 14 Node tests and 10 isomorphic-git checks pass.
- Confirmed fresh-vault Clone Remote currently cannot reach the clone path
  because `ensureGitManager()` returns before `initializeRepo()` when `.git`
  is absent.
- Confirmed all clone failures currently fall back to local initialization,
  and the empty-commit shallow path removes `.git` before clone without a
  vault-data backup.
- Confirmed ordinary settings persistence, raw logger/export data, raw error
  Notices, broad staging, and stale direct-command credentials remain open.
- Next implementation gate: approve the T35a storage/redaction contract and
  T35c repository-state/backup contract before source changes.

### T35a Secure Git-Credential Plan (2026-08-11)

- Recorded Obsidian's `SecretStorage`/`SecretComponent` as the primary
  cross-platform storage direction; ordinary settings must retain only a
  secret reference.
- Recorded the distinction between the current `isomorphic-git` transport and
  native Git credential helpers/SSH agents. Native helpers remain a future
  transport option, not an assumption for the current implementation.
- Added the migration, just-in-time resolution, no-plaintext-fallback,
  staging-exclusion, redaction, and desktop/mobile acceptance sequence to
  T35a and `implementation-details/security-and-secrets.md`.
- No production code or credential data was changed.

## T29: Plugin Auto-Updater and Release Artifacts (2026-08-10)

- Added a mobile-safe GitHub updater with stable/dev channels, daily startup
  checks, manual checks, stable auto-install, dev confirmation, and rollback.
- Embedded the build commit hash so rolling `dev` releases can identify the
  exact installed source even while the manifest remains `1.0.0`.
- Updated stable/dev CI releases to publish direct plugin assets alongside the
  ZIP; `pnpm run archive` now also copies the unpacked files directly to
  `dist/`.
- Added focused updater and archive tests. Verification passed: production
  build, 13 Node tests, 10 isomorphic-git checks, and `git diff --check`.
- Remaining gate: valid-credential Android/iOS acceptance and explicit
  authorization before tagging v1.0.0.

## Architecture Review Release Impact (2026-08-11)

The v1.0.0 gate remains open. The review identified credential-exposure,
concurrency, initialization-safety, mobile-transport, updater-integrity, and
CI-coverage risks. T29 retains release ownership; T34 retains authentication
ownership; T35 records and tracks shared hardening work.

## Milestones

| Milestone | Status | Date |
|-----------|--------|------|
| Desktop working | ✅ | 2026-05-28 |
| Proxy replaced with requestUrl | ✅ | 2026-05-30 |
| Mobile bundle clean | ✅ | 2026-05-30 |
| Mobile tested | ✅ | 2026-05-30 |
| v1.0 release | ⬜ | - |
