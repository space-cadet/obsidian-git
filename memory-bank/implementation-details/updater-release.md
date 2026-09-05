# T9: Updater and Release

## Purpose

Provide a safe, understandable way to discover and install plugin updates.

## Initial scope

- Release discovery
- Version and artifact check
- Installation
- Rollback after a failed installation

## Implemented state

The GitHub workflow builds the plugin and publishes `main.js`, `manifest.json`,
`styles.css`, and a ZIP to the rolling `latest-dev-<branch>` prerelease. The
updater supports stable and development channels, branch-build browsing,
daily/manual checks, stable-only automatic installation, identity validation,
backup, and rollback. The published build has not yet been installed, reloaded,
or forced through a rollback in Obsidian.

Rolling branch releases are updated in place. Browse Builds therefore sorts by
GitHub `updated_at` and displays that value; `published_at` can remain the
original release publication time and must not be treated as the current build
time. This correction was pushed in `2a8dead`.

## KISS boundary

Keep release handling separate from Git sync. Stable and development channels
are retained because the release workflow publishes both release types.

## Completion evidence

The updater identifies a valid update, installs it without corrupting the
plugin, and leaves the previous version recoverable after failure.
