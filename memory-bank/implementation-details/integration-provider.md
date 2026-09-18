# Integration Provider API

*Created: 2026-09-18*
*Last Updated: 2026-09-19 03:45 IST*

## Overview

`plugin.api.integrationProvider` exposes obsidian-git's capabilities to
peer plugins (first consumer: obsidian-ai) under the Integration
Provider API v1 contract. Tools are namespaced (`git.*`) and consumed
through obsidian-ai's provider registry.

## Capability Surface

| Capability | Risk | Notes |
|------------|------|-------|
| `git.status` | read | compact text status |
| `git.changed_files` | read | changed file list |
| `git.log` | read | commit history |
| `git.commit_changes` | read | files changed in a commit; accepts short hashes via `expandOid` |
| `git.stage` | write | explicit vault-relative paths only; missing paths stage as deletions (no stage-all) |
| `git.commit` | write | requires message; returns hash; author from Git Sync settings |
| `git.pull` | write | reuses the plugin's pull/auth path |
| `git.push` | write | reuses the plugin's push/auth path |

Read results are compact text. Missing-repo and missing-arg cases return
actionable errors, not throws.

## Architecture

- `src/integrationProvider.ts` — provider surface; registers the
  capabilities and formats results.
- `src/repository.ts` — `stageFile` routes missing paths to `git.remove`
  (T11); `readCommitChanges` resolves short hashes (T12); shared
  snapshot cache (T13) with invalidation on stage/commit/pull/push
  (extended by T39b).
- Registration from `src/main.ts`.

## Snapshot Cache Discipline

Read capabilities share one cached repository snapshot (T13). Every
mutation capability **must** invalidate it — a stale snapshot silently
serves wrong status/log data to the consumer. Current invalidation
points: stage, commit, pull, push.

## Evolution

- 2026-09-18 `a6f636b` (T12): read-only provider slice.
- 2026-09-18 `056c620` (T13): shared snapshot cache across reads.
- 2026-09-18 `2e4f1d9` (T39b): write tools (stage/commit/pull/push) +
  pull/push cache invalidation.

## Boundary

Credentials and auth never leave obsidian-git. The provider only wraps
operations the plugin already performs for its own UI; obsidian-ai's
auto-execute toggle is the approval gate on the consumer side.
