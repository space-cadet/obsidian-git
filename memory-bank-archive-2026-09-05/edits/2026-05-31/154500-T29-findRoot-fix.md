# Edit: 2026-05-31 15:45 IST

## Bug: Existing git repos not detected — `findRoot` directory path issue

### Problem
In vaults with existing git repositories, the sidebar showed "No git repository — initialize to create" with the Initialize/Clone buttons, instead of showing Changes and History.

### Root Cause
`isomorphic-git.findRoot()` expects a **file path**, not a directory path. When called with `filepath: '.'`, the parent-walking logic fails because `.` has no parent according to the regex `/\/[^/]*$/`. The function only checks `.git` in the current directory and immediately throws if not found.

Both `detectRealGitRepo()` in `main.ts` and `isRepository()` in `gitManager.ts` had this bug.

### Fix

**`src/main.ts` — `detectRealGitRepo()`:**
- Added Method 3: Desktop Node.js fs fallback via `window.require` (Electron only)
- Changed Method 4 (was Method 3): Use `filepath: 'dummy.txt'` instead of `filepath: '.'`
- Added `this.gitManager = null` + `return null` in `ensureGitManager()` when `isRepository()` returns false (previously it logged a warning but still returned an invalid gitManager)

**`src/gitManager.ts` — `isRepository()`:**
- Changed from `filepath: this.dir` to `filepath: 'dummy.txt'`

### Files Changed
- `src/main.ts` — `detectRealGitRepo()` + `ensureGitManager()`
- `src/gitManager.ts` — `isRepository()`

### Verification
- `pnpm run build` — compiles successfully
- Next: test on desktop with existing repo to verify detection works
