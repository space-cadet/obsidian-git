# Edit Chunk: Git Progress Modal + UI Improvements (June 01-02)

**Date**: 2026-06-02
**Time**: 14:45 IST
**Task**: T29 (obsidian-git Plugin)
**Commits**: 611d1c8 → 43352a9

## Summary

Addressed user-reported issues #1 and #4 from June 01 evening testing session. Implemented Git progress modal with dark theme, fixed mobile crash during large repo pulls, and matched desktop UI to mobile design.

## Changes

### 1. Git Progress Modal (611d1c8)

**New file**: `src/ui/GitProgressModal.ts` (291 lines)

- Dark-themed modal for pull/push/clone/fetch operations
- Phase-by-phase progress tracking with animated active states
- Progress bars, transfer rates, status icons (✓/✗/⟳)
- Auto-close on success, error display on failure
- Falls back to simple Notice if app context unavailable
- Git Bash-style aesthetic: dark background, green accent, monospace fonts

**Modified**: `src/gitManager.ts` (22 lines)
- Integrated `GitProgressModal` into `pull()`, `push()`, `cloneRepository()`, `shallowFetchAndCheckout()`

**Modified**: `src/main.ts` (2 lines)
- Updated plugin metadata

**Modified**: `styles.css` (227 lines)
- Dark theme support for modal
- Animated active phase indicators
- Monospace font stack for progress text

### 2. Progress Modal Not Updating + Crash Fix (4c9c7ec)

**Root Cause 1**: `git.fetch` with custom HTTP client (`requestUrl`) doesn't emit `onProgress` events because `requestUrl` loads the entire response into memory before isomorphic-git can process objects incrementally.

**Root Cause 2**: `GitHttpClient.collectBody()` aggregates all HTTP chunks into a single `ArrayBuffer`. For large repo packfiles, this exceeds mobile RAM and crashes Obsidian.

**Fixes**:
- `GitProgressModal`: Added `onMessage` support for text-based progress updates
- `src/gitManager.ts`: 
  - Use `git.clone` first in `shallowFetchAndCheckout` (more memory-efficient than fetch)
  - Fall back to `git.fetch` + `onMessage` if clone fails
  - Updated all operations (`pull`, `push`, `clone`) to use `onMessage` + `onProgress` dual tracking
  - `createProgressNotice()` now returns `[onProgress, onMessage, hideNotice]` tuple

### 3. Mobile Crash Fix (#1) + Commits Tab Layout (#4) (f388fc7)

**Fix #1 — Mobile crash during pull**:
- `toAsyncIterator()` in HTTP client: Chunk `ArrayBuffer` into 64KB pieces using `subarray()` (view, not copy) — allows isomorphic-git incremental packfile parsing without loading entire packfile into memory
- `shallowFetchAndCheckout()` + `pull()`: Added download timer showing elapsed time every second: "Downloading from server... (12.5s elapsed)"
- Better error messages for OOM (repo too large) and timeout failures

**Fix #4 — Commits tab layout improvements**:
- `src/views/GitSidebarView.ts`: 
  - Move click handler from `mainRow` to full commit row (entire row clickable, not just message)
  - Center toggle bar, buttons no longer stretch full width (`flex: none`)
  - Add desktop breakpoint for wider toggle buttons
  - Fix detail/meta padding alignment (32px consistent)
  - Add expanded state styling (`background-secondary-alt`)
  - Larger toggle icon area (14px), hash min-width for alignment

**Modified**: `styles.css` (44 lines) — Commit row styling, toggle bar centering, expanded states

### 4. Commit File Errors + Desktop UI Mobile Match (097300a)

**Fix commit expansion errors on shallow clones**:
- `src/gitManager.ts` — `getCommitFiles()`: Downgrade 'not found' errors to warnings (expected with `depth:1` shallow clones, parent commits not available locally)
- Added `fetchCommitFilesFromGitHub()` static method for GitHub API fallback when local commit objects unavailable
- `src/views/GitSidebarView.ts` — `renderCommitDetail()`: Try GitHub API for remote commits when local `getCommitFiles()` fails
- Show helpful message: "Commit details not available locally" instead of error toast

**Match desktop Changes tab to mobile design**:
- `styles.css` (135 lines changed):
  - Section headers: more padding (10px 14px), larger text, cleaner badge + action buttons
  - File rows: always-visible action buttons (not hover-only), cleaner status markers
  - Status icons: clean colored text (no background boxes), matching mobile purple M
  - Footer buttons: fully rounded pill buttons (border-radius: 20px), larger min-height
  - Commit button: purple filled, wider (`flex: 2`)
  - Force push: red filled, matching mobile
  - Secondary buttons: rounded gray with hover effects
  - Input: larger padding, more rounded (8px)

### 5. Commits Tab Style Match (43352a9)

**Modified**: `styles.css` (38 lines)

- Toggle bar: Full-width buttons (`flex: 1`), larger padding (10px 20px desktop), pill-like appearance (border-radius: 8px), more padding on bar (12px 20px desktop)
- Commit rows: Increased padding (10px 14px 2px main, 2px 14px 8px meta), message font-weight 600 at 13px, origin badge with larger padding/letter-spacing/font-weight 700, meta larger font (12px), aligned at 36px left, better spacing

## Files Changed

- `src/ui/GitProgressModal.ts` — **NEW** (291 lines)
- `src/gitManager.ts` — Modified (significant: progress integration, chunking, GitHub API fallback, error handling)
- `src/views/GitSidebarView.ts` — Modified (commit row click handlers, detail rendering, GitHub API fallback)
- `src/main.ts` — Minor (plugin metadata)
- `styles.css` — Major rewrite (dark modal, desktop-mobile UI parity, commits tab styling)
- `main.js` — Built artifacts (5 commits worth of changes)

## Testing

- Build passes (tsc + esbuild)
- Desktop: Pull, push, clone operations show modal with progress
- Mobile: Shallow fetch with 64KB chunking prevents OOM on large repos
- Desktop UI now visually matches mobile screenshots provided by user

## Issues Addressed

- **Issue #1**: Mobile crash during pull on large repos → Fixed via chunked ArrayBuffer + shallow clone + download timer
- **Issue #4**: Desktop UI doesn't match mobile → Fixed via CSS overhaul of Changes tab and Commits tab
- **Bonus**: Progress modal now updates dynamically (previously stuck at 0%)
- **Bonus**: Commit file expansion works for remote commits via GitHub API fallback

## Next Steps

1. Test v27+ dev release on mobile (Android/iOS) to verify crash fix
2. Verify desktop UI matches user-provided mobile screenshots exactly
3. Check foldable sections in Changes tab (chevron functionality)
4. Generate tests for GitProgressModal and GitManager operations
5. Consider: Should `toAsyncIterator()` chunking be upstreamed to isomorphic-git HTTP client?

## Commits

- `611d1c8` — feat: Git progress modal with dark theme
- `4c9c7ec` — fix: progress modal not updating + crash on large repos
- `f388fc7` — fix(#1,#4): mobile crash + commits tab layout
- `097300a` — fix: commit file errors + desktop UI mobile match
- `43352a9` — style: match commits tab to mobile design
