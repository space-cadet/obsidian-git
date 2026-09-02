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
- Settings can browse and install published branch builds.
- A feature-branch workflow publishes direct plugin assets and a ZIP using the
  same `latest-dev-<branch>` naming convention.

## Verification

- `node --test tests/updater.test.mjs`: 8/8 passed.
- `node --test tests/*.test.mjs`: 32/32 passed.
- `CI=true pnpm run build`: passed.
- `CI=true pnpm run archive`: passed; generated the versioned ZIP and unpacked
  files under `dist/`.
- `git diff --check`: passed.

## Remaining acceptance

- Verify the current dev release in real Obsidian on desktop and mobile.
- Confirm manual and automatic install reload the running plugin correctly.
- Add checksum or signed metadata verification before install.
- Clean temporary update directories after every failed download path.
