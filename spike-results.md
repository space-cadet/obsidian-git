# isomorphic-git Mobile Spike — Test Results

*Created: 2026-05-30 18:15:00 IST*
*Branch: `isomorphic-git-spike`*

## Question

Will `isomorphic-git` work in Obsidian's mobile environment (iOS/Android WebView)?

Specifically:
1. Can it bundle and load without Node.js built-ins?
2. Can it use Obsidian's Vault API as a filesystem backend?
3. Can it perform basic git operations (init, add, commit, log, status)?

## Build

✅ **PASSED**

```bash
npm run build
# tsc -noEmit -skipLibCheck && node esbuild.config.mjs production
# (no errors)
```

- Bundle size: **370KB** (including isomorphic-git + Buffer polyfill)
- No Node.js built-ins (`fs`, `path`, `child_process`, `crypto`, `os`) in output
- `Buffer` polyfilled via `buffer` npm package
- `process` references are local variables only, not global Node process

## Test Plugin

### Installation (Desktop or Mobile)

1. Download or build from branch `isomorphic-git-spike`
2. Copy `main.js`, `manifest.json`, `styles.css` (if any) to your vault's `.obsidian/plugins/obsidian-git-sync/`
3. Enable plugin in Settings → Community Plugins
4. **On mobile**: Use Obsidian Sync or iCloud/ Dropbox to transfer the files, or build on desktop and sync vault

### Running the Test

1. Open Command Palette (`Cmd/Ctrl+P` or swipe down on mobile)
2. Run: **"Test isomorphic-git (mobile spike)"**
3. Watch for Notice popup with results
4. Check console for detailed logs

### What It Tests

The command performs this sequence:
1. **git.init** — Initialize a repo in the vault root
2. **Create test file** — Write `iso-git-test.md` via Vault API
3. **git.add** — Stage the file
4. **git.commit** — Commit with test message
5. **git.log** — Read commit history
6. **git.statusMatrix** — Check working directory status

### Expected Success Output

```
Notice: "IsoGit Test ✅ PASSED
1 commits found
See console for details"
```

Console shows:
- Step-by-step success logs
- Commit objects with hash, message, author
- Status matrix entries

## Architecture

### VaultFsAdapter

Maps Obsidian Vault API → isomorphic-git Node.js fs interface:

| isomorphic-git fs | Vault API |
|---|---|
| `readFile(path, cb)` | `vault.read(file)` |
| `writeFile(path, data, cb)` | `vault.create()` / `vault.modify()` |
| `mkdir(path, cb)` | `vault.adapter.mkdir()` |
| `rmdir(path, cb)` | `vault.adapter.rmdir()` |
| `readdir(path, cb)` | `vault.adapter.list()` |
| `stat(path, cb)` | `vault.getAbstractFileByPath()` + stat |
| `unlink(path, cb)` | `vault.delete(file)` |

**Key insight:** isomorphic-git uses callback-style fs. Obsidian Vault API is promise-based. Adapter wraps promises in Node-style callbacks.

### Buffer Polyfill

isomorphic-git uses Node.js `Buffer` extensively for binary git objects. The `buffer` npm package provides a browser-compatible `Buffer` implementation. We polyfill at plugin load:

```typescript
import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
    (window as any).Buffer = Buffer;
}
```

## Mobile-Specific Concerns

| Concern | Status | Notes |
|---|---|---|
| **ESBuild bundle loads** | ✅ Likely | No Node built-ins, standard JS |
| **Buffer polyfill works** | ✅ Likely | `buffer` package is widely used, browser-tested |
| **Vault API available** | ✅ Confirmed | Core Obsidian API, works on all platforms |
| **Binary file handling** | ⚠️ Unknown | `.git/objects/` are binary; `vault.adapter.readBinary/writeBinary` used in adapter, but not tested in spike |
| **Performance (init/add/commit)** | ⚠️ Unknown | Should be fast for small files; large repos untested |
| **HTTP operations (clone/push/pull)** | ❌ Not tested | Spike only tests local operations; network ops need `requestUrl` + token auth |
| **IndexedDB/LightningFS fallback** | ❌ Not tested | Current spike uses Vault API only; may need LightningFS for `.git/` internals if Vault API has issues |

## Verdict

## Verdict: PARTIAL

Question: Will isomorphic-git work on mobile?

**Evidence:**
- Build succeeds with zero errors
- Bundle contains no Node.js dependencies
- Desktop test runs successfully (init → add → commit → log → status)

**What worked:**
- isomorphic-git bundles cleanly with esbuild
- Vault API fs adapter bridges successfully for text operations
- Basic git operations (init, add, commit, log, statusMatrix) execute without errors
- Buffer polyfill integrates cleanly

**What failed or surprised us:**
- Not tested on actual mobile device yet — this is the critical gap
- Binary file handling (`.git/objects/`) not stress-tested — Vault API's `readBinary/writeBinary` need validation
- HTTP operations (clone, push, pull) not tested — these are the real mobile challenge (CORS, tokens, requestUrl)
- Bundle size 370KB may be acceptable but needs mobile load-time validation

**Recommendation:** 

**Proceed with mobile field test.** The spike proves the core architecture is sound. Next steps:

1. **Install on mobile** (iOS or Android Obsidian app)
2. **Run the test command** — if it passes, the foundation is solid
3. **If it passes:** Proceed to Phase 3 (VaultFsAdapter refinement) and Phase 5 (HTTP client + auth)
4. **If it fails:** Debug the specific failure (likely Buffer, fs adapter edge case, or WebView JS limitation)

The riskiest remaining assumptions are:
- Binary file read/write via Vault adapter on mobile
- HTTP git protocol via `requestUrl` with token auth
- Performance on real mobile hardware

## Next Steps

| Step | Action | Owner |
|---|---|---|
| 1 | Install spike plugin on mobile | Deepak |
| 2 | Run test command, report results | Deepak |
| 3 | If pass → continue with Phase 3-7 | Sage |
| 4 | If fail → debug and iterate | Sage |

## Files

- `src/main.ts` — Minimal test plugin (replaces full plugin)
- `src/adapters/VaultFsAdapter.ts` — Embedded in main.ts for spike simplicity; should be extracted for production
- Branch: `isomorphic-git-spike`

---

*This is a throwaway spike. Do not merge to main. Results inform the production implementation on `isomorphic-git` branch.*
