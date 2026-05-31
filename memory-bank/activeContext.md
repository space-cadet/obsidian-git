# Active Context

*Last Updated: 2026-05-31 14:30:00 IST*

## Current Tasks

### T29: obsidian-git Plugin — 🔄 IN PROGRESS (v9 shipped, pending testing)
- **Scope**: Complete Git sync plugin for Obsidian using isomorphic-git
- **Sub-tasks**: T1 (Core Git), T2 (Commands/UI), T3 (Mobile), T4 (Auto-sync), T5 (Error Handling), T6 (Sidebar UI — ✅ COMPLETED), T7 (Multi-Repo — pending)
- **Phase 3**: Pack index fix, settings UI, Initialize button, v9 release
- **Pack index**: Desktop fix via `window.require('fs')` — pending user test
- **Mobile**: Initialize button + correct detection — pending user test
- **Push/pull**: GitHub fine-grained PAT — not yet tested
- **Release**: GitHub release automation — not started

## Completed Tasks

1. **T1: Core Git Integration** — Replaced proxy with `requestUrl`, implemented GitManager ✅
2. **T2: Plugin Commands & UI** — Added commands, settings, status bar, ribbon icon ✅
3. **T3: Mobile Compatibility** — v9 builds for desktop + mobile ✅
4. **T4: Auto-sync & Background** — Timer-based sync with cleanup ✅
5. **T5: Error Handling & Logging** — Replaced winston with simple Logger ✅
6. **T6: Git Sidebar UI** — Status panel, commit log, file staging ✅ (merged into T29)
   - Phase 2: Replaced LightningFS with ObsidianFsAdapter for real .git access
   - Phase 3: Pack index fix, settings UI, Initialize button, v9
7. **T7: Multi-Repo Support** — Not started (pending T29 completion)

## Next Steps
1. **Test v9 on desktop** — Verify pack index fix, Changes tab works
2. **Test v9 on mobile** — Verify Initialize button, correct "No repo" message
3. **Test push/pull with PAT** — Actual GitHub sync test
4. **T7: Multi-Repo Support** — repos in subfolders, per-repo settings, repo selector
5. **GitHub release automation** — zip + manifest + release notes
6. **Update README** with new sidebar features
7. **Plugin store submission prep**

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
