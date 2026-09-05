# T3: Vault and Local Repository

## Purpose

Connect the new plugin to the vault and expose the smallest useful local Git
state to the feature components.

## Initial scope

- Vault file access
- Repository discovery
- Explicit repository initialization
- Current branch and local status

## KISS boundary

Keep filesystem and Git access behind small interfaces. Do not add repository
repair, background polling, or broad health machinery before a real workflow
needs it.

## Completion evidence

The plugin can identify a local repository and report its basic state without
changing files during a read.
