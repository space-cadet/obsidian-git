---
kind: edit_chunk
id: 2026-06-01-1235-t32-mobile-crash-fix
created_at: 2026-06-01 12:35:00 IST
task_ids: [T29, T32]
source_branch: main
source_commit: 1140c07
---

#### 12:15:00 IST - T32: Mobile crash fix + remote commits without local repo
- Modified `src/gitManager.ts` — Added `GitProgressEmitter` class: EventEmitter-compatible for isomorphic-git progress events
- Modified `src/gitManager.ts` — Added `createProgressNotice()` helper: returns `[onProgress, hideNotice]` tuple, updates persistent Notice with phase/percentage/KB
- Modified `src/gitManager.ts` — Added `fetchRemoteCommitsViaApi()`: instance method using GitHub REST API for remote commits
- Modified `src/gitManager.ts` — Added `static fetchRemoteCommitsFromGitHub()`: static method for use without GitManager instance (no fs/dir needed)
- Modified `src/gitManager.ts` — Added `hasLocalCommits()`: checks if `git.log({ ref: 'HEAD', depth: 1 })` returns any commits
- Modified `src/gitManager.ts` — Added `cloneRepository()`: wraps `git.clone()` with progress tracking, depth parameter (default 1)
- Modified `src/gitManager.ts` — Added `shallowFetchAndCheckout()`: `git.fetch({ depth: 1 })` + `git.checkout()` for empty repos
- Modified `src/gitManager.ts` — Modified `pull()`: checks `hasLocalCommits()`, redirects to `shallowFetchAndCheckout()` if empty, uses `onProgress`
- Modified `src/gitManager.ts` — Modified `push()`: uses `onProgress` for progress tracking
- Modified `src/gitManager.ts` — Modified `initializeRepo()`: uses `cloneRepository()` instead of inline `git.clone()`
- Modified `src/logger.ts` — Added `exportToFile()`: writes all in-memory log entries to markdown file in vault, emoji-coded levels, JSON excerpts
- Modified `src/main.ts` — Added command `git-sync-export-logs`: "Export debug logs" to command palette
- Modified `src/views/GitSidebarView.ts` — `renderCommitsTab()`: handles `gitManager === null` for remote mode via `GitManager.fetchRemoteCommitsFromGitHub()`
- Modified `src/views/GitSidebarView.ts` — `renderCommitsTab()`: local mode shows empty-state when no local repo
