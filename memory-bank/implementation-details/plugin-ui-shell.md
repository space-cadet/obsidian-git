# T1: Plugin UI Shell

## Purpose

Provide the first visible version of the new plugin and the visual anchor for
all later components.

## Initial scope

- Plugin loading and unloading
- Sidebar registration
- Tab navigation
- Repository header area
- Simple loading, empty, and error states
- Sidebar Open Settings action
- One read-only local repository snapshot for the visible state

## KISS boundary

The shell stays direct. It may request one read-only local repository snapshot,
but does not manage remote operations, mutations, or a general UI framework.

## Completion evidence

The plugin sidebar and its tabs were visually confirmed in Obsidian. Loading,
missing-repository, and repository-error states are implemented. Real-host
unload verification remains open.
