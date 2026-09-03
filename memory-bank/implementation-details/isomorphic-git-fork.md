# isomorphic-git Fork and Maintenance

*Created: 2026-09-03 16:39:34 IST*
*Last Updated: 2026-09-03 19:58:37 IST*
*Task: T36*

## Purpose

Record the independent architecture and maintenance plan for evaluating and,
if necessary, forking isomorphic-git for the Obsidian Git Sync plugin.

## Decision Boundary

The fork is not yet approved as an implementation dependency. The first step
is a controlled upgrade to official isomorphic-git 1.41.9. A fork is justified
only if official 1.41.9 is compatible with the plugin but lacks required bulk
Git APIs or changes that cannot be contributed upstream in the required time.

## Upstream Baseline

- Local reference clone: `/Users/deepak/code/isomorphic-git`
- Baseline tag: `v1.41.9`
- Baseline commit: `89d641a761b56a492270933608df78edd7c9ee33`
- License: MIT; retain the upstream license and attribution.
- The source checkout does not contain generated package entrypoints and does
  not define a prepare/prepack hook. Distribution must therefore use a built
  and versioned package, or add a deliberate build hook before publishing.

## Findings Relevant to This Plugin

- Official `add()` accepts a filepath array and uses one index transaction for
  the operation. The plugin now uses bounded batches around this capability.
- Official `remove()` and `resetIndex()` remain single-file APIs. Bulk
  unstaging and reset would require either plugin orchestration or fork APIs.
- The plugin has a custom `ObsidianFsAdapter`, mobile Buffer handling, native
  `requestUrl` transport, and bundled `main.js`; all must be tested after an
  upgrade or fork adoption.
- The current plugin pins official isomorphic-git `1.41.9` in source and
  lockfile. The former `1.29.0` resolution is retained only as historical
  compatibility evidence.

## Proposed Distribution

Prefer a published, exact-version package such as:

```json
{
  "isomorphic-git": "npm:@scope/isomorphic-git@1.41.9-fork.0"
}
```

The package should contain generated CommonJS, ESM, and type artifacts, and
the plugin should continue importing the dependency as `isomorphic-git`.
Direct Git dependencies are discouraged unless the checkout reliably builds
the package during installation.

## Required API and Behavior Review

The fork review must cover:

- Bulk add with bounded memory and one index transaction per batch.
- Bulk remove/reset-index operations with one lock and one final index write.
- Staged deletion handling without reading missing worktree files.
- Explicit `.gitignore` behavior for untracked, tracked, nested, glob, and
  negated patterns.
- Index locking and rollback behavior on partial failures.
- Pack index reads through the Obsidian adapter.
- Mobile filesystem path, encoding, and binary-buffer behavior.
- Compatibility with the plugin's repository health and repair paths.

## Validation Plan

1. Upgrade the plugin to official 1.41.9 on a separate branch.
2. Run TypeScript checks, production build, unit tests, and isomorphic-git
   smoke tests.
3. Exercise staging, unstaging, deletion, pull, push, reset, and repository
   health flows on desktop.
4. Repeat the relevant flows on Android and iOS with the small acceptance
   repository and the real `typora-notes` repository.
5. Measure operation counts and elapsed time for large change sets.
6. Fork only the smallest missing capability and repeat all verification.
7. Pin the selected package version and document the upstream synchronization
   process.

## Non-Goals

- This task does not replace the plugin's `.gitignore` enforcement work.
- This task does not automatically repair a damaged mobile repository.
- This task does not assume that a newer dependency fixes missing refs,
  missing worktree files, or mobile adapter visibility problems.

## Related Tasks and Files

- T29: plugin behavior, release packaging, and mobile acceptance
- T35b: operation coordination and mutation batching
- T35d: mobile and remote transport reliability
- T35f: tests, CI, and documentation alignment
- `memory-bank/implementation-details/gitignore-controls.md`
- `memory-bank/implementation-details/reliability-and-lifecycle.md`
