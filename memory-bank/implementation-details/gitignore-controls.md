# Gitignore Controls and Hidden Dotfile Editing

*Created: 2026-08-12 15:59:54 IST*
*Last Updated: 2026-09-03 18:50:21 IST*
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

## Session Update — 2026-09-03

- The filesystem adapter now recognizes both string and object UTF-8 read
  options used by isomorphic-git, so ignore rules can be parsed as text.
- Ignored untracked files should leave the Changes list after refresh; files
  already tracked by Git remain visible until explicitly removed from the
  index.
- The adapter-backed editor now opens before the file read completes, but the
  Android keyboard still covers part of the dialog in device testing.

## Urgent Enforcement Regression — 2026-09-03

- User testing still reports that the plugin is not consistently respecting
  `.gitignore` during Git operations.
- The existing editor and per-file ignore controls do not prove that every
  status or staging path applies ignore rules.
- `GitManager.addAll(files)` currently trusts a supplied path list after
  filtering only plugin-owned paths. The next session must revalidate ignored
  untracked paths at the staging boundary.
- Add tests for ignored files, ignored directories, nested/glob/negated rules,
  automatic sync, Stage all, individual staging, and tracked-but-ignored files.
- Do not remove tracked files merely because a new ignore rule matches them;
  that remains an explicit index operation.

## Confirmed Source Diagnosis and Implementation Order — 2026-09-03

- The installed lockfile version is isomorphic-git 1.29.0. Its `add()` path
  checks `isIgnored()` without checking index membership first, so a tracked
  file that later matches `.gitignore` is silently skipped. This is contrary
  to normal Git behavior.
- `GitManager.addAll()` filters only plugin-owned paths, trusts caller-supplied
  paths, and marks each batch member staged after `git.add()` returns. A
  skipped ignored path can therefore be reported as staged even when the index
  did not change. `stageFile()` has the same no-op reporting risk.
- `statusMatrix()` correctly keeps tracked-but-ignored modifications visible;
  the fix must preserve that behavior while omitting ignored untracked files.
- Official isomorphic-git v1.41.9 has the tracked-path guard in `add()`. Test
  that release with `ObsidianFsAdapter` before considering a fork.

The code change will centralize candidate classification, use isomorphic-git
ignore evaluation, reject ignored untracked paths, preserve tracked paths,
and verify index membership/OID changes before reporting staging success. The
test matrix includes single-file, bulk, automatic-sync, nested, glob,
negated, ignored-directory, tracked-but-ignored, and deletion cases.

## Related Files

- `src/main.ts`
- `src/views/GitSidebarView.ts`
- `styles.css`
- `memory-bank/tasks/T29.md`
- `memory-bank/tasks/T35b.md`
