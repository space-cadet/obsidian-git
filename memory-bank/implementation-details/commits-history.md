# T6: Commits and History

## Purpose

Let the user inspect local and, later, remote commit history.

## Initial scope

- Commit list
- Commit details
- Changed files
- Local and remote source labels

## KISS boundary

History is read-only at first. Avoid caching, pagination, branch trees, or
remote fallback layers until the basic history view proves insufficient.

## Completion evidence

The user can select a commit and understand its message, author, time, and
changed files.
