# T6 Edit: Git Sidebar UI Implementation

*Date: 2026-05-31*
*Session: 2026-05-31-0017*

## Changes

### New Files
- `src/views/GitSidebarView.ts` — ItemView with branch info, file status, commit log, action buttons
- `styles.css` — Full sidebar styling (header, file list, commit log, footer buttons, empty states)

### Modified Files
- `src/gitManager.ts`:
  - Added `GitFileStatus`, `GitCommit` interfaces (exported)
  - Added `getDetailedStatus()` — returns files with status (modified/added/deleted/untracked/staged)
  - Added `stageFile(filepath)` — stage individual file
  - Added `unstageFile(filepath)` — reset file to HEAD
  - Added `getLog(maxCount)` — returns commit history with oid, message, author, date
  - Added `getCurrentBranch()` — returns current branch name
- `src/main.ts`:
  - Imported `GitSidebarView`, `VIEW_TYPE_GIT_SIDEBAR`
  - Registered view with `registerView()`
  - Added ribbon icon `git-branch` to open sidebar
  - Added command `git-sync-open-sidebar`
  - Added `activateGitSidebarView()` method

## UI Features
- **Header**: Branch name (with colored dot), ahead/behind count (⬆/⬇), "Up to date" when clean
- **Changes panel**: File list with status icons (M/A/D/?/S/C), stage/unstage toggle buttons on hover
- **History panel**: Commit list with 7-char hash, truncated message, relative date (just now/5m ago/2h ago)
- **Footer**: Stage All, Sync, Refresh buttons
- **Auto-refresh**: Every 30s when sidebar is visible

## Build Verification
- tsc: ✅ pass
- esbuild: ✅ pass
- Bundle: 553KB, buffer=0, path=0, process.cwd=2 (stub)

## Decisions
- Vanilla DOM (no React) to avoid bundle bloat
- `git-branch` Lucide icon for ribbon button
- Per-file stage/unstage with hover-reveal buttons
- Relative date formatting (just now → days ago → date)

## Next
- Test in actual Obsidian environment
- Consider adding diff preview on file click
- Consider adding commit message input in footer
