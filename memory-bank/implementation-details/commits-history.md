# T6: Commits and History

## Purpose

Show the existing local commit history even when the repository has no
configured or reachable remote.

## Implemented state

- The local repository bridge reads up to 50 commits through `isomorphic-git`
  `log` with changed-file metadata.
- The Commits tab renders a Local/Remote source switch using the same visual
  language as the reference layout.
- Local commits show the first-line message, abbreviated hash, author, relative
  time, and a `LOCAL` badge in a vertical timeline.
- Selecting a commit expands its full message, author, timestamp, full hash,
  and changed files with Added/Modified/Deleted markers.
- An empty repository reports `No local commits yet.` instead of treating the
  expected no-commit state as an error.
- Remote history has an explicit unavailable state until remote fetch and sync
  are implemented.

## KISS boundary

History is read-only and capped at the latest 50 local commits. Pagination,
branch trees, remote comparison, and history caching remain out of scope until
the basic local view demonstrates a need for them.

## Verification

- Production TypeScript/bundle build passed.
- `git diff --check` passed.
- The local history API returned three commits and changed-file counts from the
  current repository without using its configured remote.
