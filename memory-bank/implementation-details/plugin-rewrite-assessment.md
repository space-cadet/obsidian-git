---
source_branch: main
source_commit: e2cb6ad55885227f464b606d614b50f2f2d75f72
---

# Plugin Rewrite Feasibility and Architecture Assessment

*Created: 2026-09-03 19:58:37 IST*
*Last Updated: 2026-09-03 19:58:37 IST*
*Task: T37*

## Purpose

Capture the architectural lessons from the recurring Obsidian Git failures and
provide a decision framework for improving the current plugin versus rewriting
it. This document records an assessment, not a rewrite decision.

## Observed Architectural Pattern

The failures repeatedly crossed the same boundaries:

- **Repository reads and rendering:** The first frame could be blank, tab
  changes repeated expensive reads, and stale asynchronous responses could
  replace newer state. Header, status, history, and log data were not always
  represented as a coherent read model.
- **Mutation ownership:** Sidebar actions, commands, auto-sync, refresh, and
  settings could enter Git operations through different paths. This produced
  operation-in-progress races, delayed staging, and unclear cancellation and
  unload behavior.
- **Cache ownership:** Status, local history, remote history, commit details,
  and logs had different lifetimes and invalidation rules. Rebuilding the DOM
  was often coupled to reloading repository data.
- **Progress lifecycle:** A clone-shaped progress model was reused for pull
  and push, response-consumption bytes were mistaken for Git transfer phases,
  and timers could continue after completion. The UI lifecycle was not owned by
  the operation lifecycle.
- **Diagnostics persistence:** The Log tab depended on the current in-memory
  session while the file logger held historical data separately. Memory
  sampling also behaved as a background concern rather than an explicit
  diagnostics policy.
- **Git policy boundaries:** Ignore semantics belong to isomorphic-git, but
  staging callers could still submit stale or ignored paths and report a
  no-op as success. The policy check and index verification were not one
  mandatory staging boundary.
- **Repository state and recovery:** Fresh repositories, damaged repositories,
  empty remotes, local-only mode, and mobile ref failures were inferred from
  errors instead of modeled as explicit states with protected transitions.
- **Adapter and transport boundaries:** The Obsidian filesystem adapter,
  native `requestUrl` transport, pack/index handling, and desktop fallback
  behavior have different constraints, but acceptance has often relied on
  Node tests and source inspection rather than a shared conformance contract.
- **Release and evidence boundaries:** Source, generated `main.js`, archives,
  updater metadata, desktop behavior, Android behavior, and remote timing can
  disagree unless each is checked explicitly.

These are symptoms of an architecture that grew feature-by-feature without a
single domain model for repository state and operation ownership. They are not
proof that every module must be discarded.

## What the Current Fixes Demonstrate

The latest source work shows that several boundaries can be introduced without
a rewrite: shared status snapshots, stale-render protection, tab-specific
caches, persistent log loading, opt-in metrics, operation-specific progress,
and a staging-boundary ignore guard. Official isomorphic-git 1.41.9 also works
for the tested tracked-ignore behavior, so a dependency fork is not currently
the architectural remedy.

The remaining failures are concentrated in proof and runtime behavior:
single-coordinator coverage, unload cancellation, mobile ref visibility,
native transport buffering, large-repository timing, visual acceptance, and
release installation. That evidence should be collected before deciding that
the current code is beyond repair.

## Feasibility of a Clean Rewrite

A rewrite is technically feasible because the plugin has a bounded surface:
GitHub smart-HTTP, an Obsidian filesystem adapter, a Git manager, settings and
commands, a sidebar, progress UI, updater, and diagnostics. The difficulty is
not writing replacement TypeScript. It is preserving subtle behavior across
desktop and Android, including Git index semantics, tracked-but-ignored files,
deletions, partial clone state, credentials, pack files, cancellation, and
release artifacts.

The main rewrite risks are:

1. Reintroducing already-fixed Git and mobile regressions while rebuilding the
   UI and operation flow.
2. Losing undocumented settings, command, updater, and compatibility behavior.
3. Mistaking passing Node tests for Obsidian or Android acceptance again.
4. Creating a second implementation before the current conformance contract
   is explicit, making parity impossible to judge.
5. Extending the release period while the current plugin still has open mobile
   and repository-recovery gates.

## Advisability

A big-bang rewrite is not advised now. The current fixes demonstrate that the
most important boundaries can be extracted incrementally, while a rewrite
would multiply the number of unverified behaviors at exactly the point where
mobile and release evidence is still incomplete.

The advised path is:

1. Freeze the current behavior in a conformance suite covering status,
   ignore/staging, pull/push, recovery, cancellation, cache invalidation,
   persistent logs, progress completion, and updater artifacts.
2. Extract a single `OperationCoordinator` and explicit repository-state model
   shared by commands, sidebar, settings, and auto-sync.
3. Extract read models and stores with declared lifetimes and invalidation.
4. Make the Obsidian adapter and native transport satisfy the same contract as
   the Node test adapter, including refs, pack files, and cancellation limits.
5. Migrate the sidebar and progress surfaces to those interfaces.
6. Reassess rewrite versus continuation after real desktop and Android evidence.

This produces most of the architectural value of a rewrite while preserving a
rollback path. A clean rewrite should proceed only in a separate branch or
package, with the existing plugin retained until parity is demonstrated.

## Go / No-Go Criteria

Proceed toward a rewrite only if at least one of these becomes true:

- The coordinator, state model, or adapter boundaries cannot be introduced
  without pervasive coupling and repeated regressions.
- The conformance suite exposes incompatible assumptions that cannot be
  removed without breaking supported behavior.
- Mobile filesystem/ref/transport constraints require a different core model
  rather than better adapters and lifecycle ownership.
- The maintenance cost of incremental extraction is measured to exceed the
  cost of a parallel replacement with verified parity.

Do not authorize a rewrite solely because the UI has recurring bugs, because a
single operation is slow, or because the code feels inconsistent. Those are
signals to improve boundaries and tests, not standalone rewrite criteria.

## Evidence Required Before a Decision

- Full automated suite with concurrency and lifecycle coverage
- Obsidian desktop screenshots and operation traces
- Android clone, pull, push, stage, delete-refresh, refs, and keyboard tests
- Large-repository timing and memory measurements
- Generated bundle/archive/updater identity checks
- A documented compatibility matrix for supported settings and commands

## Decision Status

T37 is tentative and paused. No rewrite, fork, package replacement, or public
release-track change is authorized by this document.
