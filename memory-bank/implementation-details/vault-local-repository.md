# T3: Vault and Local Repository

*Last Updated: 2026-09-07 05:29:49 IST*

## Purpose

Connect the new plugin to the vault and expose the smallest useful local Git
state to the feature components.

## Initial scope

- Vault file access
- Repository discovery
- Explicit repository initialization
- Current branch and local status

## Implemented state

The plugin validates a vault-relative repository path, reads it through the
Obsidian vault adapter, and reports repository presence, branch, and HEAD
without writing files. The filesystem bridge filters missing entries from
adapter listings and reuses validated stats for the following Git calls,
avoiding transient `ENOENT`/`lstat` failures from stale mobile paths. Explicit
repository initialization remains pending.

## KISS boundary

Keep filesystem and Git access behind small interfaces. Do not add repository
repair, background polling, or broad health machinery before a real workflow
needs it.

## Completion evidence

The plugin can identify a local repository and report its basic state without
changing files during a read.
