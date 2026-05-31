# Session: 2026-05-31 15:39 IST

**Started**: 2026-05-31 15:39:00 IST
**Ended**: 2026-05-31 15:45:00 IST
**Focus Task**: T29: obsidian-git Plugin — Repo Detection Bug Fix
**Status**: ✅ CLOSED

## Summary
Fixed critical bug where existing git repositories were not detected. The sidebar showed "No git repository" even when a `.git` directory existed.

## Problem
- Fresh vault (no repo): Correctly showed "No git repository" with Initialize/Clone buttons
- Existing vault (with repo): **Incorrectly showed the same** — should show Changes and History tabs

## Root Cause
`isomorphic-git.findRoot()` expects a **file path**, not a directory path. Both `detectRealGitRepo()` and `isRepository()` passed `filepath: '.'` (a directory). The `findRoot` parent-walking regex `/\/[^/]*$/` doesn't match `.`, so it immediately throws without checking.

## Changes Made
- `src/main.ts`: Added Node.js fs fallback for desktop detection. Fixed `findRoot` to use `filepath: 'dummy.txt'`. Fixed `ensureGitManager()` to clear invalid `gitManager`.
- `src/gitManager.ts`: Fixed `isRepository()` to use `filepath: 'dummy.txt'`.
- Build: `pnpm run build` ✅ passes
- Memory-bank: Updated T29.md, edit_history.md, activeContext.md, created edit chunk

## Next Steps
- User tests on desktop with existing repo
- Verify Changes/History tabs appear correctly
- Continue with pack index and PAT testing
