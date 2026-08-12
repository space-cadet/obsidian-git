# Active Context

*Last Updated: 2026-08-12 11:27:36 IST*

## Current Tasks

### T29: obsidian-git Plugin — 🔄 updater and release artifacts verified, pending mobile acceptance
- **Scope**: Complete Git sync plugin for Obsidian using isomorphic-git
- **Sub-tasks**: T1 (Core Git), T2 (Commands/UI), T3 (Mobile), T4 (Auto-sync), T5 (Error Handling), T6 (Sidebar UI), T7 (Multi-Repo — pending), T33 (Progress Modal + UI Fixes — COMPLETED)
- **Phase 7**: v27-v29 — Git progress modal, mobile crash fix #2, desktop UI mobile match, commit file GitHub fallback
- **Status**: Core sync workflow and custom auto-updater are functional. Stable/dev release checks, commit-aware rolling dev detection, transactional installation rollback, direct CI assets, and unpacked `dist/` output are implemented. Production build, 24 Node tests, 10 isomorphic-git checks, and archive validation pass. Pending: authentication-backed mobile acceptance and public release.
- **Next**: Test the current dev release on Android/iOS with a valid credential, confirm direct CI assets and ZIP, then tag v1.0.0 only with explicit authorization.

### T34: Remote Authentication for Obsidian Git — 🔄 Diagnostics active
- **Scope**: Separate authentication task covering secret-safe PAT diagnostics,
  optional GitHub device flow, and Android/desktop authentication acceptance.
- **Status**: T34a is active. The read-only remote Test Connection repair is
  shipped; Android reaches GitHub but the supplied token was rejected with
  HTTP 401 by GitHub itself. Do not record or reuse the exposed token.
- **Children**: T34a PAT diagnostics (active); T34b GitHub device flow
  (planned); T34c Android/desktop acceptance (planned).
- **Boundary**: T29 remains release packaging/acceptance. Do not make a
  v1.0.0 tag until authentication validation and remaining mobile acceptance
  are complete.

### T35: Plugin Reliability, Security, and Architecture Hardening — 🔄 Implementation active
- **Scope**: Cross-cutting credential safety, operation coordination,
  repository initialization safety, mobile transport, updater integrity, and
  test/CI/documentation alignment.
- **Children**: T35a and T35c are active; T35b and T35d-T35f remain planned.
- **Status**: The first KIRSS implementation slice adds logger redaction,
  protected automatic staging, URL normalization, repository-error
  classification, and safe repository initialization boundaries. T35a
  SecretStorage is implemented; T35c replacement backups and T35b lifecycle
  coordination remain open. T35 is separate from T29 release ownership and
  T34 authentication ownership.
- **Next**: Add protected replacement backups and operation coordination, then
  perform mobile acceptance.

### T35a Secure Credential Storage — 🔄 SecretStorage implemented
- Obsidian `SecretStorage`/`SecretComponent` is the primary planned boundary;
  settings will store only secret references after migration.
- The current `isomorphic-git`/`requestUrl` transport cannot automatically use
  native Git credential helpers, so `osxkeychain`, Git Credential Manager,
  `libsecret`, and SSH agents remain related future options rather than
  current dependencies.
- Obsidian `SecretStorage` is now the credential boundary, with per-vault secret
  IDs, legacy migration after successful writes, unsupported-host blocking, and
  just-in-time resolution before remote operations.
- Remaining T35a work is acceptance coverage for export files, mobile setup,
  secret replacement/clearing, and the same-process plugin threat model.

### T35c Startup Clone Safety — 🔄 Fix implemented
- Sidebar refresh and manager creation are now read-only.
- Only explicit Clone Remote actions may initialize or clone a fresh vault;
  auto-sync and normal sync require an existing local repository.
- Regression coverage confirms normal sync does not contact a remote when no
  local repository exists.

### T33: Git Progress Modal + UI Fixes — ✅ COMPLETED
- **Scope**: Dark-themed progress modal, mobile crash fix via chunked ArrayBuffer, desktop UI parity with mobile, commit file GitHub API fallback
- **Priority**: HIGH
- **Parent**: T29
- **Status**: All 5 commits landed. Issues #1 and #4 from user testing resolved.
- **Files**: `src/ui/GitProgressModal.ts` (new), `src/gitManager.ts` (chunked fetch, progress integration), `src/views/GitSidebarView.ts` (commit row click, GitHub fallback), `styles.css` (major overhaul)

### T30: Remote Commits View — ✅ COMPLETED
- **Scope**: Display remote commit history alongside local in Commits tab (local/remote toggle)
- **Priority**: MEDIUM
- **Parent**: T29
- **Status**: Implemented in v25. Toggle between Local/Remote, expandable file lists.
- **Known Issue**: Expanding remote commits fails when local repo is empty — FIXED in v28 via `fetchCommitFilesFromGitHub()` fallback

### T31: Branch Tree View — ⏳ BACKLOG
- **Scope**: Multi-branch visualization and management
- **Priority**: LOW
- **Parent**: T29
- **Decision**: Intentionally deferred
- **Status**: Task doc created. No implementation planned.

## Completed Tasks

1. **T1: Core Git Integration** — Replaced proxy with `requestUrl`, implemented GitManager ✅
2. **T2: Plugin Commands & UI** — Added commands, settings, status bar, ribbon icon ✅
3. **T3: Mobile Compatibility** — v9 builds for desktop + mobile ✅
4. **T4: Auto-sync & Background** — Timer-based sync with cleanup ✅
5. **T5: Error Handling & Logging** — Replaced winston with simple Logger ✅
6. **T6: Git Sidebar UI** — Status panel, commit log, file staging ✅
7. **T30: Remote Commits View** — Local/Remote toggle, expandable commits ✅ (v25)
8. **T32: Mobile Crash Fix + Progress** — Shallow fetch, GitHub API fallback, progress notices, debug logs ✅ (v26)
9. **T33: Git Progress Modal + UI Fixes** — Dark modal, chunked ArrayBuffer, desktop-mobile parity, commit file fallback ✅ (v27-v29)

## T29: obsidian-git Plugin Completed Sub-Tasks
- **v17-v19**: Changes tab redesign (Staged/Uncommitted sections, per-file + bulk actions)
- **v20-v21**: Commit message input + separate Commit/Push/Pull/Refresh buttons
- **v22**: Token visibility bug fix
- **v23**: Pull author error fix, push rejection error handling, empty remote clone fallback
- **v24**: Force Push button (↑↑) with confirmation dialog
- **v25**: Commits tab redesign (renamed from History, expandable file lists, Local/Remote toggle)
- **v26**: Mobile crash fix, progress tracking, GitHub API remote commits, debug log export
- **v27**: Git progress modal with dark theme, phase-by-phase tracking
- **v28**: Progress modal fix (onMessage + onProgress), mobile crash fix #2 (64KB chunking), commits tab layout, commit file GitHub fallback, desktop UI mobile match
- **v29**: Commits tab style refinement (toggle bar, row spacing, bold text)
- **T29 updater**: Stable/dev GitHub release checks, commit-hash identity, mobile-safe install, backup/rollback, direct release assets, and unpacked `dist/` output ✅
- **README**: Full documentation with screenshots
- **CI**: GitHub Actions workflow (build, archive, artifact, dev release, stable release)

## Next Steps
1. **T34a: Add secret-safe authentication diagnostics** — distinguish invalid
   GitHub token, repository access denial, and Git HTTPS rejection.
2. **T34b decision** — Decide whether to implement GitHub device-flow sign-in.
3. **T34c + T29: Test the current dev release on Android/iOS** — Verify a
   valid remote credential, clone/pull/push, progress, and commit expansion.
4. **T35** — Address the recorded reliability, security, lifecycle, transport,
   updater, and CI risks.
5. **Create tagged v1.0.0 release** only after mobile acceptance, applicable
   T35 hardening, and explicit authorization.

## System Status

- **Plugin**: v1.0.0 (manifest), v29 internal dev, core features + sidebar + progress modal + crash fix + UI parity
- **Build**: ~280KB, mobile-compatible, tsc + esbuild pass
- **CI**: GitHub Actions working, dev releases on every push
- **Updater**: `PluginUpdater` uses `requestUrl` plus the vault adapter; current build identity is embedded as commit `22857f1`
- **Dev release**: https://github.com/space-cadet/obsidian-git/releases/tag/dev
- **Memory Bank**: T29/T34/T35 active, T34a/T35a/T35c active,
  T35b/T35d-T35f planned,
  T1-T6/T30/T32/T33 completed; mb-core protocols, templates, and missing
  support files initialized without overwriting existing project records
- **Branch**: `main` (isomorphic-git + ObsidianFsAdapter)

## Decisions Made

- **isomorphic-git over native git**: Cross-platform compatibility ✅
- **ObsidianFsAdapter over LightningFS**: Delegates to `app.vault.adapter` ✅
- **Node.js fs fallback**: `window.require('fs')` for pack index files on desktop ✅
- **Lazy git manager init**: Only created when sidebar opens or sync command runs ✅
- **Refresh interval 0 = disabled**: No auto-refresh when set to 0 ✅
- **Local-only mode**: Skip push/pull when no repo URL configured ✅
- **PAT auth**: Any username works with fine-grained PATs ✅
- **Connection test is read-only**: It must not require a local repository or
  clone/initialize the vault ✅
- **Authentication task separation**: T34 owns remote authentication; T29 owns
  release packaging and release acceptance ✅
- **No conditional UI hiding**: All buttons always visible, disabled when not applicable ✅
- **Dev releases on every push**: `dev` tag auto-updated, pre-release, not latest ✅
- **v1.0.0 as public release**: v26 was internal dev version ✅
- **GitHub API fallback for remote commits**: Use GitHub REST API when local repo unavailable ✅
- **Shallow fetch on empty repo**: `depth: 1` prevents mobile crash on large repos ✅
- **Progress notices**: `createProgressNotice()` shows phase, %, KB transferred ✅
- **Debug log export**: `Logger.exportToFile()` writes markdown to vault ✅
- **Git progress modal**: Dark-themed modal with phase tracking, auto-close, error display ✅
- **Chunked ArrayBuffer for mobile**: 64KB `subarray()` chunks in `toAsyncIterator()` prevents OOM ✅
- **Desktop UI matches mobile**: Changes tab and Commits tab styled identically to mobile screenshots ✅
- **Commit file GitHub fallback**: `fetchCommitFilesFromGitHub()` for shallow clones ✅
- **Release archive contains styles**: styles.css is packaged and archive layout is tested ✅
- **Test runner**: Node built-in test runner, with a bundled source test and Obsidian host stub ✅
- **Updater identity**: Rolling dev release checks compare embedded local commit hash with GitHub `main` HEAD ✅
- **Archive output**: `pnpm run archive` creates the ZIP and copies plugin files directly into `dist/` ✅
- **Hardening task boundary**: T35 owns cross-cutting reliability/security
  implementation; T29 owns release packaging/acceptance and T34 owns remote
  authentication ✅

## Decisions Pending

- **T7 repo detection**: Auto-scan depth limit? Manual add only?
- **SSH key authentication**: Currently only Basic Auth
- **GitHub device flow**: Planned under T34b; requires a GitHub App decision
- **Conflict resolution UI**: For merge conflicts
- **Mobile pack index**: LightningFS, wasm-git, or different library?
- **Mobile acceptance**: Need real-device validation of the current dev release
- **Credential storage**: T35a must choose and document the secure-storage
  boundary and automatic staging exclusions.
- **Operation coordination**: T35b must define the single-operation and
  cancellation contract.
- **Repository state machine**: T35c must define safe clone, empty-remote,
  local-only, and replacement behavior.

## Next Steps

1. **Test v29 dev release on mobile** — Verify progress modal, chunked fetch, UI parity
2. **Confirm the CI-generated dev ZIP** — Verify it contains styles.css
3. **Create tagged v1.0.0 release** — `git tag v1.0.0 && git push origin v1.0.0`
4. **Plugin store submission prep** — manifest, README, release notes
