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
- The local integration flow passed: untracked -> staged -> committed -> clean.
- A mobile `Buffer is not defined` failure was fixed with the browser Buffer
  polyfill recorded in commit `8a90e91`.

## Remaining evidence

The installed-host commit-and-clean workflow is not yet recorded. The current
presentation is functional but needs a later UI pass for compact controls,
path visibility, spacing, and Obsidian-native visual hierarchy.
