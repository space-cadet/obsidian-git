# T9: Updater and Release

## Purpose

Provide a safe, understandable way to discover and install plugin updates.

## Initial scope

- Release discovery
- Version and artifact check
- Installation
- Rollback after a failed installation

## KISS boundary

Keep release handling separate from Git sync. Add channels, signatures, or
advanced metadata only when the release workflow requires them.

## Completion evidence

The updater identifies a valid update, installs it without corrupting the
plugin, and leaves the previous version recoverable after failure.
