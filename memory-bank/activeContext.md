# Active Context

*Last Updated: 2026-06-01 10:51:00 IST*

## Current Tasks

### T29: obsidian-git Plugin — 🔄 v25 shipped, CI workflow active
- **Scope**: Complete Git sync plugin for Obsidian using isomorphic-git
- **Sub-tasks**: T1 (Core Git), T2 (Commands/UI), T3 (Mobile), T4 (Auto-sync), T5 (Error Handling), T6 (Sidebar UI), T7 (Multi-Repo — pending)
- **Phase 5**: v25 (Commits tab redesign) + CI workflow + README
- **Status**: Core sync workflow functional. Commits tab expandable. Dev releases auto-created on every push.
- **Next**: Test v25, tagged v1.0.0 release

### T30: Remote Commits View — ✅ COMPLETED
- **Scope**: Display remote commit history alongside local in Commits tab (local/remote toggle)
- **Priority**: MEDIUM
- **Parent**: T29
- **Status**: Implemented in v25. Toggle between Local/Remote, expandable file lists.

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
7. **T30: Remote Commits View** — Local/Remote toggle, expandable commits ✅ (merged into T29 v25)

## T29: obsidian-git Plugin Completed Sub-Tasks
- **v17-v19**: Changes tab redesign (Staged/Uncommitted sections, per-file + bulk actions)
- **v20-v21**: Commit message input + separate Commit/Push/Pull/Refresh buttons
- **v22**: Token visibility bug fix
- **v23**: Pull author error fix, push rejection error handling, empty remote clone fallback
- **v24**: Force Push button (↑↑) with confirmation dialog
- **v25**: Commits tab redesign (renamed from History, expandable file lists, Local/Remote toggle)
- **README**: Full documentation with screenshots
- **CI**: GitHub Actions workflow (build, archive, artifact, dev release, stable release)

## Next Steps
1. **Test v25 on desktop** — Verify Commits tab, expandable files, Local/Remote toggle
2. **Test v25 on mobile** — Verify all features work on Android/iOS
3. **Fix screenshot labels** — User noted some are incorrect (will fix later)
4. **Create tagged v1.0.0 release** — `git tag v1.0.0 && git push origin v1.0.0`
5. **Plugin store submission prep** — manifest, README, release notes

## System Status

- **Plugin**: v1.0.0 (manifest), v25 internal dev, core features + sidebar complete
- **Build**: ~280KB, mobile-compatible, tsc + esbuild pass
- **CI**: GitHub Actions working, dev releases on every push
- **Dev release**: https://github.com/space-cadet/obsidian-git/releases/tag/dev
- **Memory Bank**: T29 as top-level task, T1-T6 as sub-tasks, T30 completed
- **Branch**: `main` (isomorphic-git + ObsidianFsAdapter)

## Decisions Made

- **isomorphic-git over native git**: Cross-platform compatibility ✅
- **ObsidianFsAdapter over LightningFS**: Delegates to `app.vault.adapter` for native filesystem access ✅
- **Node.js fs fallback**: `window.require('fs')` for pack index files on desktop ✅
- **Lazy git manager init**: Only created when sidebar opens or sync command runs ✅
- **Refresh interval 0 = disabled**: No auto-refresh when set to 0 ✅
- **Local-only mode**: Skip push/pull when no repo URL configured ✅
- **PAT auth**: Any username works with fine-grained PATs ✅
- **No conditional UI hiding**: All buttons always visible, disabled when not applicable ✅
- **Dev releases on every push**: `dev` tag auto-updated, pre-release, not latest ✅
- **v1.0.0 as public release**: v25 was internal dev version ✅

## Decisions Pending

- **T7 repo detection**: Auto-scan depth limit? Manual add only?
- **SSH key authentication**: Currently only Basic Auth
- **Conflict resolution UI**: For merge conflicts
- **Mobile pack index**: LightningFS, wasm-git, or different library?
