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

## KISS boundary

The shell does not read Git state, manage remote operations, or contain a
general UI framework. It should render predictable static states first.

## Completion evidence

The new plugin loads in Obsidian and the sidebar remains usable while switching
between its initial tabs.
