# Active Context

*Last Updated: 2026-05-31 00:17:00 IST*

## Current Tasks

### T6: Git Sidebar UI — ✅ COMPLETED (2026-05-31)
- Create dedicated sidebar panel showing git status, commit history, file changes
- Status view: changed files (staged/unstaged), diff preview, stage/unstage buttons
- Log view: commit list with hash, message, author, date
- Branch info, remote status (ahead/behind)
- Auto-refresh on file changes
- **Implemented**: GitSidebarView, styles.css, stage/unstage per-file, relative dates, auto-refresh 30s

### T7: Multi-Repo Support — 🆕 ACTIVE
- Support git repos in subfolders, not just vault root
- Auto-detect `.git` directories in vault
- Per-repo settings (URL, branch, auth, auto-sync)
- Repo selector in UI (settings + sidebar)
- Migration from single-repo settings

## Completed Tasks (Recent)

1. **T1: Core Git Integration** — Replaced proxy with `requestUrl`, implemented GitManager
2. **T2: Plugin Commands & UI** — Added commands, settings, status bar, ribbon icon
3. **T3: Mobile Compatibility** — v9 works on desktop + mobile! ✅
4. **T4: Auto-sync & Background** — Timer-based sync with cleanup
5. **T5: Error Handling & Logging** — Replaced winston with simple Logger
6. **T6: Git Sidebar UI** — Status panel, commit log, file staging, auto-refresh ✅

## Next Steps
1. **T7: Multi-Repo Support** — repos in subfolders, per-repo settings, repo selector
2. Test T6 sidebar in actual Obsidian environment
3. Update README with new sidebar feature
4. Plugin store submission prep

## System Status

- **Plugin**: Core features + sidebar complete, mobile testing ✅
- **Build**: 553KB, mobile-compatible
- **Memory Bank**: 7 tasks (6 completed, 1 active)
- **Branch**: `main` (isomorphic-git, mobile-ready)

## Decisions Pending

- **T6 UI approach**: Vanilla DOM ✅ (no React, keeps bundle small)
- **T7 repo detection**: Auto-scan depth limit? Manual add only?
- Whether to add SSH key authentication (currently only Basic Auth)
- Whether to add conflict resolution UI for merge conflicts
