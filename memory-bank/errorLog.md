# Error Log

## 2026-09-05

- **mb-core integration test**: `mb db test` failed because its workflow test
  expected `database/test_output/` files that the test did not create. The
  fresh SQLite schema and database initialization succeeded. No mb-core source
  was changed.
