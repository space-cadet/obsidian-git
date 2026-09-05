# Project Brief
*Last Updated: 2026-09-05 23:35:25 IST*

## Project Overview
**Project Name**: Obsidian Git
**Description**: A simple Obsidian plugin for viewing and synchronising a vault with Git.

## Objectives
1. Build a functional plugin from a clean implementation.
2. Make the UI visible and useful before adding Git operations.
3. Support the common local and remote workflows without speculative machinery.

## Key Features
- UI shell and Settings panel
- Local file status, staging, commit, and history
- Remote pull, push, sync, and clone
- Activity, progress, errors, and updater support

## Constraints
- Keep the implementation simple and component-owned.
- Do not copy the previous plugin implementation.
- Add handling for an edge case only when a real workflow requires it.
- Treat automated, desktop, mobile, remote, and release evidence separately.

## Success Metrics
- The plugin loads and presents a usable shell.
- A user can configure a repository and complete the basic Git workflow.
- The same workflows are verified in the supported Obsidian environments.
