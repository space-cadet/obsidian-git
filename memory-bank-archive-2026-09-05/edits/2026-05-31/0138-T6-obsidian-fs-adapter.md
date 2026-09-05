# T6: Git Sidebar UI — Fix: Real .git Repo Detection

*Session: 2026-05-31 01:17-01:38 IST*

## Problem
User's vault is a real git repo (`/Volumes/Data/owncloud/Notes/typora-notes/`) but plugin showed "No git repo detected" because:
1. `LightningFS` creates a virtual filesystem that cannot see the actual `.git` directory
2. `vaultPath` was set to the vault's display name, causing isomorphic-git to look in a non-existent subdirectory

## Solution: ObsidianFsAdapter

Created a custom filesystem adapter that delegates all operations to `app.vault.adapter`, which accesses the real filesystem on both desktop and mobile.

### Files Changed
- **Created**: `src/adapters/ObsidianFsAdapter.ts` — Custom fs backend for isomorphic-git
  - `readFile(path)` → `adapter.readBinary(path)`
  - `writeFile(path, data)` → `adapter.writeBinary(path, data)`
  - `readdir(path)` → `adapter.list(path)` + `adapter.stat()` for dirs
  - `stat(path)` → `adapter.stat(path)` with type mapping (`folder`→`dir`, `file`→`file`)
  - `mkdir(path)` → `adapter.mkdir(path)`
  - `rmdir(path)` → `adapter.rmdir(path)`
  - `unlink(path)` → `adapter.remove(path)`
  - `readlink(path)` → reads symlink content via `adapter.read()`
  - `lstat(path)` → same as `stat()` (no separate lstat in Obsidian adapter)
  - `symlink(target, path)` → `adapter.write(path, target)` (content stores target path)
  - `rename(old, new)` → `adapter.rename(old, new)`
  - `join(path, ...parts)` → string join with `/` separator
  - `normalize(path)` → normalizes `./`, `../`, `//` segments

- **Modified**: `src/main.ts`
  - Replaced `import FS from '@isomorphic-git/lightning-fs'` with `import { ObsidianFsAdapter } from './adapters/ObsidianFsAdapter'`
  - Changed `this.fs` from `new FS('gitfs')` to `new ObsidianFsAdapter(this.app)`
  - Fixed `detectRealGitRepo()` to use `adapter.read('.git/HEAD')` then `adapter.stat('.git')` then `git.findRoot()`
  - Fixed `vaultPath` to empty string `''` (vault root) instead of vault display name
  - All commands (pull/push/status/sync) now use centralized `ensureGitManager()`
  - Sidebar auto-initializes gitManager on refresh if repo detected

- **Modified**: `src/gitManager.ts`
  - Removed `import * as fs from '@isomorphic-git/lightning-fs'`
  - No longer initializes LightningFS internally — receives fs from main

- **Modified**: `src/views/GitSidebarView.ts`
  - `refresh()` now calls `await this.plugin.ensureGitManager()` if not initialized
  - Shows "Local only" mode when no remote configured but local repo exists

- **Modified**: `package.json`
  - Removed `@isomorphic-git/lightning-fs` from dependencies
  - Added `.gitignore` for `*.zip`

## Build
- tsc: ✅ pass
- esbuild: ✅ pass
- Bundle: ~280KB (smaller without LightningFS)

## Commits
- `5cc6b11` — refactor(T6): Replace LightningFS with ObsidianFsAdapter
- `9577028` — fix(T6): Auto-init gitManager, fix path resolution for real .git repos

## Open Issues
- **Android detection not working**: User reports plugin still says "No .git repo found" on Android. Need to verify `adapter.stat()` works on mobile. May need to use `app.vault.adapter.list()` as fallback.
- **Desktop testing pending**: User will test on desktop tomorrow.

## Key Insight
The existing `obsidian-git` plugin (denolehov) uses the same pattern: custom fs adapter delegating to `app.vault.adapter`. This is the correct approach for accessing real filesystem while staying cross-platform.

## Pattern for Future
When using isomorphic-git inside Obsidian, NEVER use LightningFS. Always create a custom adapter that delegates to `app.vault.adapter`. This gives native filesystem access on both desktop and mobile.
