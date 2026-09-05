---
kind: edit_chunk
id: 2026-05-30-214600
created_at: 2026-05-30 21:46:00 IST
task_ids: [T3]
source_branch: simple-git
source_commit: f9e06a9
---

#### 21:46:00 IST - T3: Build and verify mobile bundle
- Modified `esbuild.config.mjs` — Removed `buffer` and `path` from `builtins` external list so they are bundled
- Modified `package.json` — Added `buffer` npm package dependency (needed by `safe-buffer` which is pulled in by `isomorphic-git` → `sha.js`)
- Modified `esbuild.config.mjs` — Added banner that stubs `process` and `Buffer` for mobile WebView
- Built `main.js` (526K) — verified no `require("buffer")` or `require("path")` in bundle
- Created `dist/obsidian-git-sync-v6.zip` — 107K zip with main.js + manifest.json