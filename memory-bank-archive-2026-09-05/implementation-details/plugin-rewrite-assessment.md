---
source_branch: main
source_commit: 4f7d04b1a2d5870cb32ddabd13e4ae822256eb3f
---

# Plugin Rewrite Feasibility and User-Workflow Assessment

*Created: 2026-09-03 19:58:37 IST*
*Last Updated: 2026-09-04 00:05:23 IST*
*Task: T37*

## Purpose

Capture the lessons from the recurring Obsidian Git failures and provide a
decision framework for improving the current plugin versus replacing it. This
document records an assessment, not a rewrite decision.

The module recommendations recorded in earlier versions of this document are
historical suggestions, not requirements. The current decision standard is
KISS: begin with the smallest direct change that fixes a demonstrated user
problem.

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

The latest source work shows that several reported behaviours can be improved
without replacing the plugin: status can be read once for a refresh, stale
view results can be ignored, logs can include retained history, progress can
describe the operation being performed, and staging can enforce Git ignore
rules. Official isomorphic-git 1.41.9 also works for the tested
tracked-but-ignored behaviour, so a dependency fork is not currently needed.

The remaining gaps are user acceptance and a small number of concrete safety
questions: mobile ref visibility, native transport buffering, large-repository
timing, visual acceptance, release installation, cancellation, and what should
happen when two Git actions are requested together. These should be tested as
user workflows. They are not evidence that a collection of new modules is
required.

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

Do not start a rewrite or a broad extraction plan yet. First run the actual user
workflows against the current plugin and record which ones work, still fail, or
have not been tested.

For a failing workflow, try the smallest direct fix first. The only generally
justified shared behaviour at present is that a long Git action can be
cancelled, that conflicting mutations do not damage the repository, and that
an old asynchronous result is not shown in a changed view. Even these may be
implemented locally if that keeps the code clearer.

Consider a replacement only if the current implementation cannot meet a
required workflow without more code and indirection than a small replacement
would need. If that point is reached, keep the current plugin available and
compare the replacement against the user workflows, not against a prescribed
module structure.

## Go / No-Go Criteria

Proceed toward a rewrite only if at least one of these becomes true:

- A required user workflow still fails after the smallest reasonable direct fix.
- The current code cannot support the required mobile or repository behaviour
  without adding substantially more complexity than a replacement would need.
- A replacement can be compared against the current product with real desktop,
  Android, and live-remote evidence.

Do not authorize a rewrite solely because the UI has recurring bugs, because a
single operation is slow, or because the code feels inconsistent. Those are
signals to improve boundaries and tests, not standalone rewrite criteria.

## Evidence Required Before a Decision

- Focused tests for the specific behaviours being changed
- Obsidian desktop screenshots and operation traces
- Android clone, pull, push, stage, delete-refresh, refs, and keyboard tests
- Large-repository timing and memory measurements
- Generated bundle/archive/updater identity checks
- A documented compatibility list for supported settings and commands

## Decision Status

T37 is tentative and paused. No rewrite, fork, package replacement, or public
release-track change is authorized by this document.

## Historical Architecture Review — 2026-09-04

The saved report
[`pocock-architecture-review.html`](pocock-architecture-review.html) is a
historical review of the current checkout. Its proposed extraction order and
named modules are not part of the current plan and should not be used as
rewrite requirements.
