# Gitignore Controls and Hidden Dotfile Editing

*Created: 2026-08-12 15:59:54 IST*
*Last Updated: 2026-08-12 15:59:54 IST*
*Tasks: T29, T35b*

## Purpose

Record how the Changes tab exposes `.gitignore` even though Obsidian does not
show dotfiles in its file explorer.

## Delivered Behavior

- The sidebar exposes an Edit `.gitignore` action and the command palette has
  an Open `.gitignore` command.
- Each changed file has an ignore action that adds a root-anchored pattern.
- Add pattern accepts folder and glob rules such as `attachments/` and
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

## Open Follow-up

The Changes tab bulk Add all action currently stages only the first ten files
in a large change set. This is recorded for a separate implementation session;
the cause and fix are not yet established.

## Related Files

- `src/main.ts`
- `src/views/GitSidebarView.ts`
- `styles.css`
- `memory-bank/tasks/T29.md`
- `memory-bank/tasks/T35b.md`
