---
kind: edit_chunk
id: 2026-05-30-225600
created_at: 2026-05-30 22:56:00 IST
task_ids: [T3]
source_branch: simple-git
source_commit: 2d63bfb
---

#### 22:56:00 IST - T3: Mobile compatibility achieved — v9 works on mobile!
- Modified `esbuild.config.mjs` — Banner now always ensures `process.cwd` exists (even if `process` partially defined on mobile)
- Post-processed `main.js` — Added `globalThis.Buffer = require_buffer().Buffer;` at end of bundle
- Built `dist/obsidian-git-sync-v9.zip` — tested and confirmed working on mobile device
- Updated `memory-bank/tasks/T3.md` — Status changed to COMPLETED
- Updated `memory-bank/activeContext.md` — T3 marked complete
- Updated `memory-bank/progress.md` — Mobile milestones marked complete

**Key fixes that made mobile work:**
1. Removed `buffer`/`path` from esbuild externals → bundled them into main.js
2. Added `buffer` npm package as dependency for `safe-buffer` (via `isomorphic-git` → `sha.js`)
3. Banner: `var process = (globalThis.process || {}); if (!process.cwd) process.cwd = () => '/';` — ensures `cwd` always exists
4. Post-build: `globalThis.Buffer = require_buffer().Buffer;` — makes bundled Buffer available globally for `isomorphic-git`
5. No `require("buffer")` or `require("path")` in final bundle