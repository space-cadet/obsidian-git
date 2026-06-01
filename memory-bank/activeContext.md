# Active Context

*Last Updated: 2026-05-31 14:30:00 IST*

## Current Tasks

### T29: obsidian-git Plugin — ✅ Core features complete (v24: Force Push, auth fixes, empty remote handling)
- **Scope**: Complete Git sync plugin for Obsidian using isomorphic-git
- **Sub-tasks**: T1 (Core Git), T2 (Commands/UI), T3 (Mobile), T4 (Auto-sync), T5 (Error Handling), T6 (Sidebar UI — ✅ COMPLETED), T7 (Multi-Repo — pending)
- **Phase 4**: v17-v24 releases (Changes tab, staging, commit UI, PAT support, Force Push)
- **Status**: Core sync workflow functional. Force Push works. Token visibility bug fixed. Pull author bug fixed.
- **Next**: T30 Remote Commits View

### T30: Remote Commits View — 🆕 PLANNED
- **Scope**: Display remote commit history alongside local in History tab (local/remote toggle)
- **Priority**: MEDIUM
- **Parent**: T29
- **Design**: Toggle between Local/Remote in History tab; fetch remote log via `git.log({ ref: 'origin/main' })`
- **Value**: User sees actual remote commits behind "ahead/behind" numbers
- **Decision**: Option B (toggle) — simpler than split-pane, less UI risk
- **Status**: Task doc created. Implementation doc needed before building.

### T31: Branch Tree View — ⏳ BACKLOG
- **Scope**: Multi-branch visualization and management
- **Priority**: LOW
- **Parent**: T29
- **Decision**: Intentionally deferred — scope creep, isomorphic-git lacks merge support, niche for Obsidian users
- **Revisit if**: explicit user request, clear use case emerges, plugin matures
- **Status**: Task doc created. No implementation planned.

## Completed Tasks

1. **T1: Core Git Integration** — Replaced proxy with `requestUrl`, implemented GitManager ✅
2. **T2: Plugin Commands & UI** — Added commands, settings, status bar, ribbon icon ✅
3. **T3: Mobile Compatibility** — v9 builds for desktop + mobile ✅
4. **T4: Auto-sync & Background** — Timer-based sync with cleanup ✅
5. **T5: Error Handling & Logging** — Replaced winston with simple Logger ✅
6. **T6: Git Sidebar UI** — Status panel, commit log, file staging ✅ (merged into T29)
   - Phase 2: Replaced LightningFS with ObsidianFsAdapter for real .git access
   - Phase 3: Pack index fix, settings UI, Initialize button, v9
   - Phase 4: Changes tab redesign (v17-v19), Commit UI (v20-v21), Auth fixes (v22-v24)

## T29: obsidian-git Plugin Completed Sub-Tasks
- **v17-v19**: Changes tab redesign (Staged/Uncommitted sections, per-file + bulk actions, collapsible, mobile-friendly)
- **v20-v21**: Commit message input + separate Commit/Push/Pull/Refresh buttons. All buttons always visible (no conditional hiding). Footer re-renders on refresh.
- **v22**: Token visibility bug fix — `inputEl.type = 'password'` set immediately, not just in `onChange`
- **v23**: Pull author error fix, push rejection error handling, empty remote clone fallback
- **v24**: Force Push button (↑↑) with confirmation dialog
7. **T7: Multi-Repo Support** — Not started (pending T29 completion)

## Next Steps
1. **T30: Remote Commits View** — Create implementation doc, build v25 with remote log fetch + toggle in History tab
2. **Test v24 on mobile** — Verify Force Push dialog, all footer buttons visible
3. **Token obfuscation UI** — Settings password field: partial masking + eye icon (requested by user)
4. **T7: Multi-Repo Support** — repos in subfolders, per-repo settings, repo selector
5. **GitHub release automation** — zip + manifest + release notes
6. **Update README** with new sidebar features
7. **Plugin store submission prep**
8. **T31: Branch Tree View** — Backlogged, revisit if explicitly requested

## System Status

- **Plugin**: v9 shipped, core features + sidebar complete
- **Build**: ~280KB, mobile-compatible, tsc + esbuild pass
- **Memory Bank**: T29 as top-level task, T1-T7 as sub-tasks
- **Branch**: `main` (isomorphic-git + ObsidianFsAdapter)

## Decisions Made

- **isomorphic-git over native git**: Cross-platform compatibility (mobile support) ✅
- **ObsidianFsAdapter over LightningFS**: Delegates to `app.vault.adapter` for native filesystem access ✅
- **Node.js fs fallback**: `window.require('fs')` for pack index files on desktop ✅
- **Lazy git manager init**: Only created when sidebar opens or sync command runs ✅
- **Refresh interval 0 = disabled**: No auto-refresh when set to 0 ✅
- **Local-only mode**: Skip push/pull when no repo URL configured ✅
- **PAT auth**: Any username works with fine-grained PATs ✅

## Decisions Pending

- **T7 repo detection**: Auto-scan depth limit? Manual add only?
- **SSH key authentication**: Currently only Basic Auth
- **Conflict resolution UI**: For merge conflicts
- **Mobile pack index**: LightningFS, wasm-git, or different library?
