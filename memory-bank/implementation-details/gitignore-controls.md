# Gitignore Controls and Hidden Dotfile Editing

*Created: 2026-08-12 15:59:54 IST*
*Last Updated: 2026-08-18 13:05:58 IST*
*Tasks: T29, T35b*

## Purpose

Record how the Changes tab exposes `.gitignore` even though Obsidian does not
show dotfiles in its file explorer.

## Delivered Behavior

- The sidebar exposes Edit `.gitignore` and ignored-pattern management through
  the Changes tab's `More` menu; the command palette still has an Open
  `.gitignore` command.
- Each changed file keeps a compact `…` menu with an ignore action that adds a
  root-anchored pattern, plus an Edit `.gitignore` action.
- The pattern editor accepts folder and glob rules such as `attachments/` and
  `temp/**`.
- Duplicate patterns are ignored.
- Hidden-file reads and writes use `vault.adapter`, because the Obsidian vault
  index may omit an existing dotfile from `getFileByPath`.
- When no indexed `TFile` is available, a dedicated adapter-backed editor
  modal reads, edits, and saves `.gitignore` directly.

## Git Semantics

Adding a tracked path to `.gitignore` does not remove it from the Git index.
The rule affects future untracked files; removing an already tracked file from
the index remains a separate, explicit operation.

## Test Fixture

`space-cadet/git-test-small` is the deliberately small private GitHub fixture
used for clone, edit, commit, push, and mobile acceptance checks. The older
`space-cadet/git-test` repository is not a minimal fixture and contains
historical configuration data.

## UI Follow-up

The bulk Add all limit has been investigated and fixed in the current source:
the sidebar passes its visible unstaged file list to the manager, the manager
continues through the full list, and the UI reports the actual staged and
failed counts. The remaining acceptance gate is a real Obsidian run with a
large change set.

## Related Files

- `src/main.ts`
- `src/views/GitSidebarView.ts`
- `styles.css`
- `memory-bank/tasks/T29.md`
- `memory-bank/tasks/T35b.md`
