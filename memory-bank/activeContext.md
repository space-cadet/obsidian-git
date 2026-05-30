# Active Context

*Last Updated: 2026-05-30 22:56:00 IST*

## Current Tasks

### T6: Git Sidebar UI — 🆕 ACTIVE
- Create dedicated sidebar panel showing git status, commit history, file changes
- Status view: changed files (staged/unstaged), diff preview, stage/unstage buttons
- Log view: commit list with hash, message, author, date
- Branch info, remote status (ahead/behind)
- Auto-refresh on file changes

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

## Next Steps
1. ✅ Mobile compatibility achieved — T3 COMPLETE!
2. **T6: Build Git sidebar UI** — status panel, log view, commit history
3. **T7: Add multi-repo support** — repos in subfolders, per-repo settings
4. Update README with mobile setup instructions
5. Add documentation for users (setup guide, troubleshooting)
6. Plugin store submission

## System Status

- **Plugin**: Core features complete, mobile testing ✅
- **Build**: Ready for production build
- **Memory Bank**: Expanded with 7 tasks (5 completed, 2 active)
- **Branch**: `simple-git`

## Decisions Pending

- **T6 UI approach**: Vanilla DOM vs React vs Obsidian built-ins
- **T7 repo detection**: Auto-scan depth limit? Manual add only?
- Whether to add SSH key authentication (currently only Basic Auth)
- Whether to add conflict resolution UI for merge conflicts
