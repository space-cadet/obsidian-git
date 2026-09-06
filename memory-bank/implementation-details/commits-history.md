# T6: Commits and History

## Purpose

Show existing local and fetched remote commit history, including when the
repository has no configured or reachable remote.

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
- Remote history reads the fetched `refs/remotes/origin/<branch>` tracking ref
  and uses the same timeline and expanded details as Local history.
- Remote commits use an `ORIGIN` badge; an unfetched branch has an explicit
  state prompting the user to Fetch.

## KISS boundary

History is read-only and capped at the latest 50 commits per source. Pagination,
branch trees, remote comparison, and history caching remain out of scope until
the basic local and fetched-remote views demonstrate a need for them.

## Verification

- Production TypeScript/bundle build passed.
- `git diff --check` passed.
- The local history API returned three commits and changed-file counts from the
  current repository without using its configured remote.
- The user verified that the local Commits display works in the pushed build.
- Remote history source loading is covered by the production build; live
  Fetch and installed-host verification remain open.
