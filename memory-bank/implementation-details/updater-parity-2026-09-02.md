# Updater parity follow-up — 2026-09-02

## Decision

Use the updater structure already working in the local `obsidian-ai` checkout
as the reference for `obsidian-git`. Keep `obsidian-git's` existing
transactional install and rollback behavior where it is stronger.

## Implemented

- GitHub release and asset requests include cache-busting and validate HTTP
  status codes.
- GitHub error messages are retained for manual checks, so a missing stable
  release is not presented as an up-to-date installation.
- Updater diagnostics are written through the existing Git Sync logger.
- Rolling dev checks use the commit recorded in the release body. This works
  when the release keeps the same `dev` tag but publishes a new build.
- The current build branch is embedded alongside its commit hash. Dev checks
  prefer a matching `latest-dev-<branch>` release and fall back to the rolling
  main build.
- Settings can browse and install every published stable, rolling-dev, and
  branch-specific development build.
- A feature-branch workflow publishes direct plugin assets and a ZIP using the
  same `latest-dev-<branch>` naming convention.

## Verification

- `node --test tests/updater.test.mjs`: 10/10 passed after commit `910c5f5`.
- `node --test tests/*.test.mjs`: 34/34 passed after commit `910c5f5`.
- `CI=true pnpm run build`: passed.
- `CI=true pnpm run archive`: passed; generated the versioned ZIP and unpacked
  files under `dist/`.
- `git diff --check`: passed.

## Remaining acceptance

- Verify the current dev release in real Obsidian on desktop and mobile.
- Confirm manual and automatic install reload the running plugin correctly.
- Add checksum or signed metadata verification before install.
- Clean temporary update directories after every failed download path.

## Sidebar typography follow-up — 2026-09-02

The final mockup override block had promoted ordinary sidebar content to medium
or 20–24px text. Tabs, status text, file paths, commit metadata, log rows, and
footer controls now use the compact Obsidian small UI scale, with only branch
and commit titles retaining a modest visual hierarchy. The compact row sizes
are explicit so a theme-level UI scale cannot silently promote them back to
medium text.

## Dev metadata repair and follow-up audit — 2026-09-02

- Commit `910c5f5` fixed the main workflow/parser mismatch: the workflow now
  emits the parser's preferred commit metadata, while the parser also accepts
  the older unformatted body and falls back to the selected branch head when
  optional metadata is absent.
- The updater must not use strict metadata requirements to hide published
  builds. Optional commit metadata improves presentation and comparison, but
  release discovery remains permissive; install-time asset and plugin-identity
  checks remain the meaningful safety checks.
- The next updater follow-up should publish the commit subject in release
  metadata, display it as the build's primary description, and remove the full
  SHA from generated release titles. Historical builds without a subject may
  use a cached commit lookup or a clear fallback label.
- Real Obsidian desktop/mobile verification of the corrected rolling `dev`
  release remains pending.
