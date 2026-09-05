---
kind: edit_chunk
id: 005316-T35f-entrypoint-conformance
created_at: 2026-09-04 00:53:16 IST
task_ids: [T35b, T35f, T37]
source_branch: main
source_commit: 2b7c2593e20c7d8f3ec2c9f07a60e31a6ac0bf10
---

# T35f entry-point conformance checkpoint

## Change Summary

- Added AST-backed source conformance coverage for repository mutation entry
  points in `src/main.ts` and `src/views/GitSidebarView.ts`.
- Added lifecycle assertions for coordinator disposal and GitManager signal
  cleanup.
- Updated task, progress, session, and changelog records with the focused
  verification and remaining runtime acceptance gaps.

## Files Changed

- `tests/operation-entrypoint-conformance.test.mjs`
- `memory-bank/tasks/T35b.md`
- `memory-bank/tasks/T35f.md`
- `memory-bank/tasks/T37.md`
- `memory-bank/tasks.md`
- `memory-bank/activeContext.md`
- `memory-bank/session_cache.md`
- `memory-bank/sessions/2026-09-03-afternoon.md`
- `memory-bank/progress.md`
- `memory-bank/changelog.md`

## Verification

- `node --test tests/operation-entrypoint-conformance.test.mjs` passed (2/2).
- Full package verification remains the final pre-commit check for this
  checkpoint.
