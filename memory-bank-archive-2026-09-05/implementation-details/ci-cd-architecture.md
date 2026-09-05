# CI/CD Architecture — obsidian-git Plugin

*Created: 2026-06-01 10:51:00 IST*
*Last Updated: 2026-09-02 19:26:31 IST*

## Overview

The obsidian-git plugin uses GitHub Actions for continuous integration and automated releases. Every push to `main` triggers a build, and the result is published as a downloadable pre-release.

## Workflow: `.github/workflows/build-release.yml`

### Triggers

| Event | Action |
|-------|--------|
| `push` to `main` | Build + archive + upload artifact + update `dev` release |
| `push` to `main` with `v*` tag | Build + archive + create stable release |
| `pull_request` to `main` | Build + archive + upload artifact (no release) |
| `workflow_dispatch` | Manual trigger for any branch |

### Jobs

#### 1. `build`

Runs on every trigger. Steps:

1. **Checkout** — `actions/checkout@v4`
2. **Setup Node.js** — Node 20 via `actions/setup-node@v4`
3. **Setup pnpm** — pnpm 9 via `pnpm/action-setup@v4`
4. **Setup pnpm cache** — `actions/cache@v4` with `~/.pnpm-store`
5. **Install dependencies** — `pnpm install --frozen-lockfile`
6. **Build plugin** — `pnpm run build` (tsc + esbuild)
7. **Build archive** — `pnpm run archive` (custom ZIP generator)
8. **Upload artifact** — `actions/upload-artifact@v4` (30-day retention)
9. **Verify build output** — `ls -lh` on dist/ and root files

**Output:**
- `main.js` — bundled plugin (~630KB)
- `manifest.json` — plugin metadata
- `versions.json` — version compatibility
- `styles.css` — plugin styles
- `README.md` — documentation
- `dist/*.zip` — archive with all files in `obsidian-git-sync/` subdirectory

#### 2. `dev-release`

Runs only on `push` to `main`. Depends on `build`.

Creates or updates a **pre-release** at `https://github.com/space-cadet/obsidian-git/releases/tag/dev`.

**Configuration:**
- `tag_name: dev` — fixed tag, updated in-place
- `prerelease: true` — marked as pre-release
- `make_latest: false` — does not appear as "latest" release
- Release name: currently `Dev Build (<full-sha>)`; change this to a branch or
  descriptive title without the full SHA.
- Body includes: commit SHA, branch, timestamp; add the commit subject so the
  updater can show the message for each build.

The updater remains permissive when optional release metadata is absent. Its
install-time checks, rather than release presentation fields, are responsible
for validating the downloaded plugin.

#### 3. `release`

Runs only on `push` with `v*` tag. Depends on `build`.

Creates a **stable release** with the tag name.

**Configuration:**
- `generate_release_notes: true` — auto-generates changelog from commits
- No `prerelease` flag — appears as latest stable release

## Build Process

### Build Script: `pnpm run build`

```
tsc -noEmit -skipLibCheck && node esbuild.config.mjs production
```

1. **TypeScript check** — `tsc -noEmit` validates types without emitting
2. **esbuild bundle** — `esbuild.config.mjs` bundles `src/main.ts` into `main.js`
   - Format: CommonJS (`cjs`)
   - Target: ES2018
   - External: obsidian, electron, codemirror, lezer (Obsidian-provided)
   - Bundled: isomorphic-git, buffer, path-browserify
   - Banner: stubs `process` and `Buffer` for mobile WebView

### Archive Script: `pnpm run archive`

```
node scripts/build-archive.mjs
```

Custom ZIP generator using only Node.js built-ins (no external dependencies):

1. Reads `manifest.json` for plugin ID and version
2. Includes: `main.js`, `manifest.json`, `versions.json`, `styles.css`, `README.md`
3. Creates ZIP with files in `<plugin-id>/` subdirectory
4. Output: `dist/<plugin-id>-v<version>.zip`

**Archive structure:**
```
obsidian-git-sync/
  main.js
  manifest.json
  versions.json
  styles.css
  README.md
```

## Test Process

`pnpm test` builds the production bundle, then runs the Node built-in test
runner followed by an end-to-end `isomorphic-git` smoke test in a temporary
repository. It verifies the
release archive layout and manifest version, zero-copy response chunking,
progress callbacks, persistent notice cleanup, and init/status/add/commit/log
operations. `pnpm run build` remains the production TypeScript and esbuild
verification step.

This structure allows extraction directly into `.obsidian/plugins/`:
```bash
unzip obsidian-git-sync-v1.0.0.zip -d /path/to/vault/.obsidian/plugins/
```

## CI Fixes Applied

### Fix 1: Pnpm Cache Path

**Problem:** Dynamic `pnpm store path` detection failed in CI.

```yaml
# BROKEN — outputs empty path
- run: echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT
- uses: actions/cache@v4
  with:
    path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
```

**Solution:** Use fixed path `~/.pnpm-store`.

```yaml
# FIXED
- uses: actions/cache@v4
  with:
    path: ~/.pnpm-store
```

### Fix 2: Workspace Packages Field

**Problem:** `pnpm install --frozen-lockfile` failed with "packages field missing or empty".

**Root cause:** `pnpm-workspace.yaml` only had `allowBuilds`:
```yaml
allowBuilds:
  esbuild: true
```

**Solution:** Add `packages` field:
```yaml
packages:
  - '.'

allowBuilds:
  esbuild: true
```

## Version Strategy

| Version | Meaning | When to Bump |
|---------|---------|-------------|
| `manifest.json` version | Public release version | Before tagging stable release |
| `v25` | Internal dev version | During development (not in manifest) |
| `dev` tag | Rolling pre-release | Auto-updated on every push |
| `v1.0.0` | First stable release | When plugin is ready for public use |

**Release process:**
```bash
# Update manifest.json version
# Commit and push
# Create tag
git tag v1.0.0
git push origin v1.0.0
# CI creates stable release automatically
```

## Artifact Retention

- **GitHub artifact:** 30 days (via `actions/upload-artifact@v4`)
- **Dev release:** Persistent (tag is updated, not deleted)
- **Stable release:** Permanent (GitHub releases are immutable)

## Monitoring

View runs via `gh` CLI:
```bash
gh run list --workflow=build-release.yml
gh run view <run-id>
gh run view <run-id> --log-failed
```

View releases:
```bash
gh release list
gh release view dev
```

## Security

- `GITHUB_TOKEN` is auto-provided by GitHub Actions
- No secrets stored in repository
- PATs for git operations are user-configured in Obsidian settings (not in CI)

## Architecture Review Update (2026-08-11)

The workflow currently builds and archives the plugin but does not execute the
full `pnpm test` suite in CI. T35f tracks adding the complete test command and
integration coverage to pull requests and release jobs.

T35e also tracks release-artifact identity checks. The source build, tracked
`main.js`, ZIP contents, direct release assets, embedded commit hash, and
manifest version should either be generated from one verified artifact or be
compared explicitly so a stale checked-in bundle cannot be mistaken for the
current source.

Updater assets are executable plugin code. Release publishing should provide
checksums or signed metadata, and the updater should verify those values before
installation.
