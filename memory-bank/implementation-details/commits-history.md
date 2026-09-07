# T6: Commits and History

*Last Updated: 2026-09-07 05:29:49 IST*

## Purpose

Show existing local and fetched remote commit history, including when the
repository has no configured or reachable remote.

## Implemented state

- The local repository bridge reads 100 commit summaries per page through
  `isomorphic-git` `log` without eagerly calculating changed-file metadata.
- The Commits tab renders a Local/Remote source switch using the same visual
  language as the reference layout.
- Local commits show the first-line message, abbreviated hash, author, relative
  time, and a `LOCAL` badge in a vertical timeline.
- Selecting a commit expands its full message, author, timestamp, full hash,
  and lazy-loaded changed files with Added/Modified/Deleted markers.
- An empty repository reports `No local commits yet.` instead of treating the
  expected no-commit state as an error.
- Remote history reads the fetched `refs/remotes/origin/<branch>` tracking ref
  and uses the same timeline and expanded details as Local history.
- Remote commits use an `ORIGIN` badge; an unfetched branch has an explicit
  state prompting the user to Fetch.
- The repository context header reports the comparison state when fetched
  local and remote history is available.
- Local and remote sources have independent pagination and “Load more commits”
  controls. Expanded commit details load changed files lazily and cache them.

## KISS boundary

History is read-only and paginated at 100 commits per source. Branch trees and
broad history caches remain out of scope; expanded commit details use a small
per-view cache because they are explicitly requested by the user.

## Verification

- Production TypeScript/bundle build passed.
- `git diff --check` passed.
- The local history API returned three commits and changed-file counts from the
  current repository without using its configured remote.
- The user verified that the local Commits display works in the pushed build.
- The user verified that the Remote commits display works in the pushed build.
- Installed-host verification of the complete history workflow remains a
  separate platform record.
