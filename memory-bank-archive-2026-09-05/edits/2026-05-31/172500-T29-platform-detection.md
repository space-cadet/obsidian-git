# Edit: 2026-05-31 17:25 IST

## Platform Detection + Diagnostics Command

### Problem
User frustrated with piecemeal fixes going in circles. Asked for:
1. Platform detection that works properly
2. Plugin test/diagnostic option (was removed in LightningFS→ObsidianFsAdapter refactor)
3. One thing done properly before building upon it

### Changes

**`src/main.ts`:**
1. Added `isDesktop` property to plugin class — detects Electron by checking `window.require` and `window.process`
2. Log platform at startup: "desktop (Electron)" or "mobile (WebView)"
3. Rewrote `detectRealGitRepo()` to be platform-aware:
   - **Desktop**: tries Node.js fs FIRST (most reliable via `adapter.getBasePath()` + `fs.access`)
   - **Mobile**: skips Node fs, uses Obsidian adapter methods + findRoot
   - **Both**: adapter.read('.git/HEAD') → adapter.stat('.git') → isomorphic-git findRoot with dummy.txt
4. Simplified `ensureGitManager()`: removed redundant `isRepository()` call since `detectRealGitRepo()` already verified repo exists
5. Added `runCompatibilityDiagnostics()` method + command `git-sync-test-compatibility`:
   - Reports platform, window.require/process availability
   - Tests Node fs on desktop (basePath, .git access)
   - Tests Obsidian adapter (.git/HEAD readability, .git stat)
   - Tests isomorphic-git findRoot
   - Reports repo detection result
   - Runs git init test (creates temp repo, verifies, cleans up)
   - Shows results in a modal dialog

### Rationale
Platform detection must happen early and be reliable. Desktop has Node.js fs which is much more reliable for reading `.git` directory than Obsidian's DataAdapter (which has issues with binary files). Mobile has no Node.js so must rely on adapter + findRoot.

### Files Changed
- `src/main.ts`

### Build
- `pnpm run build` ✅ passes

### Next
User to run diagnostics on both desktop and mobile, report results. Then fix whatever the diagnostics reveal.
