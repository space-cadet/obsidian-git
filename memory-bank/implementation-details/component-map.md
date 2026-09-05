# Component Map

The task registry follows app components. The build order begins with the
visible shell and Settings so the product has a visual anchor immediately.

1. T1 UI shell
2. T2 Settings panel
3. T3 Vault and local repository
4. T4 Changes panel
5. T5 Activity and logging
6. T6 Commits and history
7. T7 Remote sync and authentication
8. T8 Progress, errors, and dialogs
9. T9 Updater and release
10. T10 Platform integration and verification

Each component owns its small state, operations, UI, and focused checks.

## Current implementation status

- T1 and T2: sidebar shell, settings tab, and sidebar Settings entry point are implemented.
- T3: read-only local repository discovery is implemented; initialization remains pending.
- T5: live in-memory Activity is implemented; persistence, clear, and export remain pending.
- T9: updater and branch development releases are implemented; real-host installation remains pending.
- T10: local and GitHub build evidence exists; desktop and mobile acceptance remain pending.
Dependencies are added only when a component cannot function without them.
