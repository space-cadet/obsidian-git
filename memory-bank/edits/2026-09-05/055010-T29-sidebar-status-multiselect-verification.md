# T29 Sidebar Status and Multi-Select Verification

*Created: 2026-09-05 05:50:10 IST*

## Scope

Document the latest sidebar status-pipeline fixes, Changes-tab selection and
destructive actions, product-contract correction, and verification evidence.

## Changes

- Recorded the desktop `readlink` failure and broken ignored symlink handling.
- Recorded status classification, filtering, sorting, review, discard, and
  multi-select behavior across T29, T29a, T35b, T35c, and T35f.
- Corrected the product records to distinguish the removed Settings Sync Now
  action from retained ribbon and command-palette manual sync.
- Recorded 83 general tests, 16 rewrite tests, 10 smoke checks, artifact
  identity, and `git diff --check`.
- Preserved the open real Obsidian desktop/mobile acceptance boundary.

## Evidence Boundary

Automated verification proves source/build behavior only. It does not prove
visual or interaction acceptance in an installed Obsidian desktop or mobile
runtime.
