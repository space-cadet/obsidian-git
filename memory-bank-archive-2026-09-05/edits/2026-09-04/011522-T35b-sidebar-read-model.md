---
kind: edit_chunk
id: 011522-T35b-sidebar-read-model
created_at: 2026-09-04 01:15:22 IST
task_ids: [T35b, T35f, T37]
source_branch: main
source_commit: f0574f9102ee5780ec69fbe88ff08d4f03665d21
---

# Sidebar read-model extraction

## Change Summary

- Added a testable `SidebarReadModel` for plugin-lifetime history, commit
  detail, and activity-log cache ownership.
- Integrated it into the sidebar without moving rendering or Git mutations.
- Added cache-key and invalidation tests and updated the architecture records.

## Files Changed

- `src/sidebarReadModel.ts`
- `src/views/GitSidebarView.ts`
- `tests/sidebar-read-model.test.mjs`
- Memory Bank task, implementation, session, progress, changelog, and
  edit-history records.

## Verification

- `CI=true pnpm test` passed: 67 Node tests, artifact identity, production
  build, and 10 isomorphic-git checks.
- `git diff --check` passed.
- Real Obsidian desktop/mobile acceptance remains open.
