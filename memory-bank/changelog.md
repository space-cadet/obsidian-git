# Changelog

## 2026-09-06

- Added the Git Sync sidebar shell, repository states, Activity tab, and
  sidebar Open Settings action. - T1, T2, T3, T5
- Added stable/development update discovery, build browsing, transactional
  installation, rollback, and branch development releases. - T9, INFRA
- Recorded local and GitHub build evidence; real-host install/reload checks
  remain open. - T10
- Added the local Changes workflow, including DataAdapter-backed status,
  stage/unstage, commit, and mobile Buffer support. - T4, T10
- Corrected rolling branch-build ordering and timestamp display to use release
  `updated_at`. - T9
- Added Settings auto-save and secure token visibility controls. - T2
- Added the target Changes layout and render-preserving staging updates. - T4
- Added persistent structured Log entries with full timestamps and severity. - T5
- Added the initial remote connection and credential foundation. - T7
- Recorded user verification of the pushed Changes and Log behavior. - T10
- Added versioned plugin-data export/import with optional Activity history. - T2
- Added Local/Remote Commits history and repository comparison states. - T6
- Added Fetch, Pull, Push, and Clone transport flows with queued diagnostics. - T7
- Moved Pull, Push, and Fetch to the Changes toolbar and removed duplicate
  Settings operation controls. - T4
- Fixed Pull author identity and Push request-body handling after user Log
  evidence; the user confirmed both toolbar actions now work. - T5, T7

## 2026-09-05

- Started the clean component-based rebuild of Obsidian Git.
- Added the UI shell and Settings panel as the first implementation tasks.
- Archived the previous implementation records outside the fresh Memory Bank.
