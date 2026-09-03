## [2026-09-03 13:11:02 IST]: T35c/T35d - Existing mobile repository ref resolution

**File:** `src/gitManager.ts`, `src/adapters/ObsidianFsAdapter.ts`

**Error Message:**
```
Could not find refs/heads/main
```

**Cause:**
Unresolved. On mobile, the existing non-empty `typora-notes` repository cannot
resolve the expected local branch ref during the index-repair dry run, while
the health view reports `main` with no commits.

**Fix:**
Not fixed yet. The next session must inspect mobile reads of `HEAD`, local
branch refs, and remote-tracking refs before selecting a safe recovery path.

**Affected Files:**
- `src/gitManager.ts`
- `src/adapters/ObsidianFsAdapter.ts`

**Related Task:** T35c/T35d
