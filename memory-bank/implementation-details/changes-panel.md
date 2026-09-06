# T4: Changes Panel

## Purpose

Show local file changes and provide the basic local commit workflow.

## Initial scope

- Changed-file list
- Stage and unstage
- Commit message
- Commit action

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
- Stage and unstage refresh only the Changes content while preserving the
  panel shell, active control, commit-message focus, and scroll position. A
  later mobile check found that full repository refreshes still rebuilt the
  visible Changes state; those refreshes now update the existing shell in
  place and restore scroll after layout.
- Pull and Push are connected to the shared remote operation queue and emit
  Activity diagnostics while they run; Settings remains configuration-only.
- The local integration flow passed: untracked -> staged -> committed -> clean.
- A mobile `Buffer is not defined` failure was fixed with the browser Buffer
  polyfill recorded in commit `8a90e91`.

## Remaining evidence

The user verified the pushed Changes build, including staging behavior, working
Pull and Push toolbar actions, scroll preservation, and the in-place refresh
correction. Filtering, sorting, revert, and keyboard multi-selection remain
planned refinements.
