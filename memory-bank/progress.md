# Project Progress

*Last Updated: 2026-08-10 23:19:04 IST*

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

## Milestones

| Milestone | Status | Date |
|-----------|--------|------|
| Desktop working | ✅ | 2026-05-28 |
| Proxy replaced with requestUrl | ✅ | 2026-05-30 |
| Mobile bundle clean | ✅ | 2026-05-30 |
| Mobile tested | ✅ | 2026-05-30 |
| v1.0 release | ⬜ | - |
