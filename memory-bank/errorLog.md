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

## [2026-09-03 16:39:34 IST]: T29/T35a/T35b - Gitignore not consistently enforced

**File:** `src/gitManager.ts`, `src/views/GitSidebarView.ts`

**Error / Symptom:**

User reports that the plugin still stages or presents files that should be
excluded by the repository's `.gitignore` rules.

**Cause:**

Unresolved. The current staging boundary filters plugin-owned paths, but a
caller-supplied file list is not independently revalidated against Git ignore
rules. Status discovery and staging behavior also need an explicit cross-path
regression test.

**Fix:**

Not fixed yet. Next session must reproduce the issue on mobile and desktop,
enforce ignore rules centrally for untracked paths, preserve tracked-but-ignored
Git semantics, and add coverage for status, individual staging, bulk staging,
and automatic sync.

**Related Task:** T29/T35a/T35b/T35f
