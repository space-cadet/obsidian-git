# Active Context

*Last Updated: 2026-06-02 14:45 IST*

## Current Tasks

### T29: obsidian-git Plugin — 🔄 v29 shipped, issues #1/#4 fixed, pending mobile test + tests
- **Scope**: Complete Git sync plugin for Obsidian using isomorphic-git
- **Sub-tasks**: T1 (Core Git), T2 (Commands/UI), T3 (Mobile), T4 (Auto-sync), T5 (Error Handling), T6 (Sidebar UI), T7 (Multi-Repo — pending), T33 (Progress Modal + UI Fixes — COMPLETED)
- **Phase 7**: v27-v29 — Git progress modal, mobile crash fix #2, desktop UI mobile match, commit file GitHub fallback
- **Status**: Core sync workflow functional. Progress modal fully operational. Desktop UI now matches mobile design. Commit file expansion works via GitHub API for shallow clones. Pending: mobile test, foldable Changes tab sections, tests.
- **Next**: Test dev release on mobile (Android/iOS), implement foldable Changes tab sections, generate tests for GitProgressModal and GitManager

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
- **README**: Full documentation with screenshots
- **CI**: GitHub Actions workflow (build, archive, artifact, dev release, stable release)

## Next Steps
1. **Test v29 on mobile** — Verify progress modal, chunked fetch, shallow clone, commit file expansion
2. **Foldable Changes tab sections** — Staged/Uncommitted chevrons don't work on desktop; need toggle functionality
3. **Generate tests** — GitProgressModal, GitManager operations, chunked ArrayBuffer
4. **Create tagged v1.0.0 release** — `git tag v1.0.0 && git push origin v1.0.0`
5. **Plugin store submission prep** — manifest, README, release notes

## System Status

- **Plugin**: v1.0.0 (manifest), v29 internal dev, core features + sidebar + progress modal + crash fix + UI parity
- **Build**: ~280KB, mobile-compatible, tsc + esbuild pass
- **CI**: GitHub Actions working, dev releases on every push
- **Dev release**: https://github.com/space-cadet/obsidian-git/releases/tag/dev
- **Memory Bank**: T29 top-level, T1-T6 sub-tasks, T30/T32/T33 completed
- **Branch**: `main` (isomorphic-git + ObsidianFsAdapter)

## Decisions Made

- **isomorphic-git over native git**: Cross-platform compatibility ✅
- **ObsidianFsAdapter over LightningFS**: Delegates to `app.vault.adapter` ✅
- **Node.js fs fallback**: `window.require('fs')` for pack index files on desktop ✅
- **Lazy git manager init**: Only created when sidebar opens or sync command runs ✅
- **Refresh interval 0 = disabled**: No auto-refresh when set to 0 ✅
- **Local-only mode**: Skip push/pull when no repo URL configured ✅
- **PAT auth**: Any username works with fine-grained PATs ✅
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

## Decisions Pending

- **T7 repo detection**: Auto-scan depth limit? Manual add only?
- **SSH key authentication**: Currently only Basic Auth
- **Conflict resolution UI**: For merge conflicts
- **Mobile pack index**: LightningFS, wasm-git, or different library?
- **Foldable Changes tab sections**: Need toggle/accordion logic for Staged/Uncommitted
- **Test framework**: Vitest? Jest? Obsidian API mocking strategy?

## Next Steps

1. **Test v29 dev release on mobile** — Verify progress modal, chunked fetch, UI parity
2. **Foldable Changes tab sections** — Implement chevron toggle for Staged/Uncommitted
3. **Generate tests** — GitProgressModal, GitManager, chunking logic
4. **Create tagged v1.0.0 release** — `git tag v1.0.0 && git push origin v1.0.0`
5. **Plugin store submission prep** — manifest, README, release notes
