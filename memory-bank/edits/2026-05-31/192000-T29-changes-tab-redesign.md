# Edit Chunk: 2026-05-31 19:20 IST

## T29: Changes Tab Redesign — Staged / Uncommitted Sections

### Problem
- Per-file staging appeared to stage all files (user clicked wrong button, or UI was unclear)
- Changes tab showed all files in one flat list with mixed status icons — hard to distinguish staged vs unstaged
- No bulk unstage button existed
- File action buttons hidden until hover (broken on mobile touch)

### Changes

**`src/gitManager.ts`**
- Added `getStatusGroups(): Promise<{ staged: string[]; unstaged: string[] }>` — computes groups directly from `git.statusMatrix` raw values (`stage !== 1 && stage !== 0` = staged, `workdir !== 1 && !staged` = unstaged)
- Fixed `getDetailedStatus()` classification: `staged + modified` files (head=1, workdir=2, stage=2) now correctly labeled `'staged'` instead of `'modified'`
- Added `unstageAll(): Promise<void>` — iterates statusMatrix, calls `unstageFile()` on each staged file

**`src/views/GitSidebarView.ts`**
- Replaced `renderStatusTab()` with two-section layout:
  - **Staged** section: sticky header with "Staged" label + `[− all]` button, each file has `[−]` button → `unstageFile()`
  - **Uncommitted Changes** section: sticky header with label + `[+ all]` button, each file has `[+]` button → `stageFile()`
- Added `renderStatusSection()` helper: reusable section renderer with header, bulk action, per-file actions
- Removed "Stage All" from footer (now lives in section header)
- All handlers use explicit `this.plugin.gitManager!` (guarded by null check) instead of optional chaining that could silently no-op

**`styles.css`**
- Added `.git-status-container`, `.git-status-section`, `.git-status-section-header`, `.git-status-section-label`, `.git-status-section-action`, `.git-status-section-list`
- Section headers are `position: sticky; top: 0; z-index: 1` for scroll context
- Added `@media (hover: none)` query: `.git-file-actions` always visible on touch devices (mobile), `.git-status-section-action` gets larger touch target

### Build
- `pnpm run build` — tsc + esbuild both pass cleanly

### Next
- Test on mobile: verify per-file `[+]` / `[−]` buttons work, verify `[+ all]` / `[− all]` bulk actions work
- Verify staged+modified files appear only in "Staged" section (simplified; future enhancement: show both)
- Test desktop pack index fix with existing repo

---
*Chunk created: 2026-05-31 19:20 IST*
*Task: T29*
