---
kind: edit_chunk
id: 2026-06-01-0951-t29-ci-workflow
created_at: 2026-06-01 09:51:00 IST
task_ids: [T29, T30]
source_branch: main
source_commit: 9604adef7d00978242051b07e11140d0a02c5320
---

#### 09:06:00 IST - T29: v25 Commits tab redesign
- Modified `src/gitManager.ts` - Added `getCommitFiles()` method: recursively diffs commit trees to find added/modified/deleted files for expandable commit view
- Modified `src/gitManager.ts` - Added `getRemoteLog()` method: fetches `origin/main` (or configured branch) commits via `git.log({ ref: 'origin/branch' })`
- Modified `src/gitManager.ts` - Added private `readTreeRecursive()` helper for tree traversal
- Modified `src/views/GitSidebarView.ts` - Renamed "History" tab to "Commits"
- Modified `src/views/GitSidebarView.ts` - Added `commitsViewMode` state ('local' | 'remote') with toggle bar UI
- Modified `src/views/GitSidebarView.ts` - Made commits expandable: click to show changed files with +/−/● icons
- Modified `src/views/GitSidebarView.ts` - Added `renderCommitDetail()` for lazy-loaded file change lists
- Modified `styles.css` - Added `.git-commits-toggle-bar`, `.git-commits-toggle-btn`, `.git-commits-toggle-active` styles
- Modified `styles.css` - Added `.git-commit-detail`, `.git-commit-file-row`, file status icon styles (+ green, − red, ● blue)
- Modified `styles.css` - Added `.git-commit-remote` with accent left border and `.git-commit-remote-badge`

#### 09:30:00 IST - T29: README + screenshots
- Created `README.md` - Comprehensive documentation: features, installation, setup, troubleshooting, changelog
- Created `screenshots/sidebar-overview.jpg` - Full sidebar view for README
- Created `screenshots/changes-tab.jpg` - Changes tab with staged/uncommitted files
- Created `screenshots/commits-tab.jpg` - Commits tab with Local/Remote toggle and expandable files

#### 10:10:00 IST - T29: GitHub Actions CI workflow
- Created `.github/workflows/build-release.yml` - GitHub Actions workflow: build, archive, upload artifact on push/PR
- Created `.github/workflows/build-release.yml` - `dev-release` job: creates/updates `dev` pre-release on every push to main
- Created `.github/workflows/build-release.yml` - `release` job: creates stable release on `v*` tags
- Modified `pnpm-workspace.yaml` - Added `packages: ['.']` field for pnpm CI compatibility
- Modified `README.md` - Updated installation instructions to reference GitHub Releases
- Modified `README.md` - Clarified v25 as internal dev, 1.0.0 as public release version
