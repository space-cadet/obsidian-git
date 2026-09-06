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

- T1 and T2: sidebar shell, settings tab, sidebar Settings entry point, and
  versioned plugin data export/import are implemented.
- T3: read-only local repository discovery is implemented; initialization remains pending.
- T4: local Changes list, stage/unstage, commit controls, render-preserving
  updates, and DataAdapter Git operations are implemented; filter, sort,
  revert, and keyboard selection remain planned.
- T5: structured, persistent Log entries with timestamps and severity are
  implemented; clear and export remain pending.
- T6: local and fetched remote commit history, commit details, changed-file
  display, and comparison status are implemented.
- T7: remote connection testing, SecretStorage-backed credentials, Fetch,
  fast-forward-only Pull, Push, and Clone are implemented and user-verified;
  richer progress and edge-case handling remain planned.
- T9: updater and rolling branch-release ordering are implemented; real-host installation remains pending.
- T10: local, GitHub, and user-installed pushed-build evidence exists; platform-
  specific desktop, Android, and iOS acceptance remains to be recorded.
Dependencies are added only when a component cannot function without them.
