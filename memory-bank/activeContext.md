# Active Context

*Last Updated: 2026-09-05 23:35:25 IST*

## Current Focus

- **T1: Plugin UI Shell** — first implementation component
- **T2: Settings Panel** — follows the shell and is also active

## Current State

The old Memory Bank is archived. The plugin itself is not being carried into
this branch. The fresh implementation starts with a visible shell and usable
Settings panel before repository or sync components are built.

## Current Decisions

- Tasks are organized by app component, not abstract project goals.
- Keep the task tree shallow and the implementation direct.
- Do not add edge-case machinery without a demonstrated need.

## Next Actions

1. Build the sidebar shell and its basic states.
2. Build Settings against the shell.
3. Verify the visual anchor in Obsidian before adding the next component.
