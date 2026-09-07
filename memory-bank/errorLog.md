# Error Log

## 2026-09-07

- **Stale mobile adapter paths**: Obsidian's index could list a path that had
  already moved or been deleted, producing `ENOENT`/`lstat` failures during Git
  reads. The filesystem bridge now filters missing entries and reuses validated
  stats for the following calls in `da7a4a6`.

## 2026-09-05

- **mb-core integration test**: `mb db test` failed because its workflow test
  expected `database/test_output/` files that the test did not create. The
  fresh SQLite schema and database initialization succeeded. No mb-core source
  was changed.

## 2026-09-06

- **pnpm workspace config**: a generated `pnpm-workspace.yaml` caused pnpm 9
  frozen installs to fail with `packages field missing or empty`; the file was
  removed in `c675818`.
- **Mobile Git runtime**: `Buffer is not defined` occurred when Changes invoked
  `isomorphic-git`; a browser Buffer polyfill was added in `8a90e91`.
