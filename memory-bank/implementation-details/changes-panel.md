# T4: Changes Panel

*Last Updated: 2026-09-07 05:29:49 IST*

## Purpose

Show local file changes and provide the basic local commit workflow.

## Initial scope

- Changed-file list
- Stage and unstage
- Commit message
- Commit action

## UI mockups

- [`changes-multiselect-mockup-v1.png`](../assets/changes-multiselect-mockup-v1.png) is the preferred base layout for compact selection actions and multi-selection feedback.
- [`changes-multiselect-mockup-v2.png`](../assets/changes-multiselect-mockup-v2.png) adds the section filter/sort controls, section-specific `+`/`−` actions, and the expanded file overflow menu.

## KISS boundary

Start with a clear list and direct actions. Add selection modes, bulk actions,
review flows, or special recovery only when the basic workflow exposes a need.

## Completion evidence

The user can edit a vault file, see it in Changes, stage it, commit it, and see
the resulting clean state.

## Implemented state

- The Changes tab reads local status through an Obsidian `DataAdapter` bridge
  backed by `isomorphic-git`; a remote URL is not required.
- It renders changed files, individual Stage/Unstage controls, a commit message
  field, commit identity settings, and a Commit action.
- Its fixed bottom action bar exposes Pull, Push, and Fetch for the configured
  remote, keeping remote synchronization next to the Changes workflow.
- The approved mobile layout uses grouped staged and uncommitted sections,
  counts, collapsible headers, selection controls, and icon actions.
- Desktop Cmd/Ctrl-click, Shift-click ranges, mobile long-press dragging,
  per-section status filters/sorts, and file overflow actions are implemented.
- Stage and unstage refresh only the Changes content while preserving the
  panel shell, active control, commit-message focus, and scroll position. A
  later mobile check found that full repository refreshes still rebuilt the
  visible Changes state; those refreshes now update the existing shell in
  place and restore scroll after layout.
- Pull and Push are connected to the shared remote operation queue and emit
  Activity diagnostics while they run; Settings remains configuration-only.
- Full vault-wide Changes scans are authoritative but manual: they run on
  initial/context refreshes or explicit Refresh. Successful known mutations
  reconcile local state, while uncertain states show “Changes need refreshing”.
- The local integration flow passed: untracked -> staged -> committed -> clean.
- A mobile `Buffer is not defined` failure was fixed with the browser Buffer
  polyfill recorded in commit `8a90e91`.

## Remaining evidence

The user verified the pushed Changes build, including staging behavior, working
Pull and Push toolbar actions, scroll preservation, and the in-place refresh
correction. Revert remains a planned refinement; selection, filtering, sorting,
overflow actions, and targeted reconciliation are implemented.
