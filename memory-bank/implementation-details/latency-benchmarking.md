# Latency Investigation and Tuning

*Last Updated: 2026-09-07 05:21:33 IST*

## Purpose

This document consolidates the benchmarking, instrumentation, diagnosis, and
performance tuning carried out around slow Git and Changes-panel behavior. It
covers the earlier T35d/T40 investigation and the corresponding work on the
clean `codex/kiss-restart` implementation.

## Executive summary

The latency was not one isolated network problem. Several independent costs
could make an operation feel slow:

- A full working-tree `statusMatrix` scan across the vault.
- Eager changed-file tree walks for every commit in history.
- Repeated Changes refreshes after staging, commits, and remote operations.
- Per-file staging or unstaging calls during bulk actions.
- An extra working-tree scan and post-push history walk after Push.
- Large or unpaginated Activity and commit-history reads/rendering.
- Stale mobile adapter entries that could turn a scan into an error or retry.

The response was to measure each meaningful phase, remove redundant work, bound
large reads, update known state locally where safe, and keep an explicit full
refresh as the authoritative escape hatch.

## Investigation tracks

### Earlier backend diagnosis

The T35d investigation added per-request HTTP timing with request ID, method,
elapsed milliseconds, response status, response size, and outcome. Pull also
received phase timing for remote setup, fetch, ref resolution, local safety
checks, merge, checkout, and total duration (`bfe42cf`). This separated network
waiting from the local work performed after data arrived.

The evidence indicated that post-fetch local work needed attention rather than
assuming that the remote transfer was the only bottleneck. The related T40
rendering work then retained Activity, Changes, and progress-modal nodes,
coalesced vault refresh events, and separated live updates from persisted-log
reads (`7744ddb`, `8880cea`).

### Clean-restart diagnosis

The clean implementation continued the same evidence-first approach. The
instrumentation was added before the larger tuning pass so that repository
inspection, Changes, local commits, remote commits, staging, and remote
operations could be compared separately in Activity.

There is not a controlled before/after benchmark table for the target
`typora-notes` vault in the repository. The available evidence is source-level
phase instrumentation, commit-by-commit removal of redundant work, production
build checks, and user testing on the pushed mobile build. The Activity metrics
are the intended mechanism for collecting the remaining real-vault timings.

This is currently an investigation and tuning record, not a completed
benchmark report: the repository does not yet contain controlled before/after
measurements for the target vault.

Evidence in this document is intentionally mixed but should be read as:

- measured: timings emitted by Activity or the earlier HTTP/Pull diagnostics;
- source-derived: behavior established by the implementation and commit diff;
- user-observed: behavior verified in the pushed Obsidian build;
- build-verified: production build or static diff checks.

## Measurement added

Repository refreshes record total time and separate timings for:

- Local repository inspection.
- Changes/status reading.
- Local commit history.
- Remote commit history.
- The reason for the refresh and the counts returned by each read.

Stage, unstage, commit, targeted Changes refresh, remote-history refresh, and
remote-operation completion or failure each record elapsed time. Push formerly
also recorded its working-tree status scan; that scan was later removed after
it was identified as avoidable overhead.

Remote diagnostics preserve the operation context and phase names. The earlier
backend path additionally reports HTTP request timing, response metadata, and
Pull's internal phases. Git output is sanitized before it reaches Activity.

## Tuning sequence

| Commit | Change | Latency reason or result |
| --- | --- | --- |
| `8eddbbf` | Added repository, staging, remote, and operation metrics. | Made the expensive phase visible instead of guessing. |
| `81528f4` | Removed tab-switch timing entries. | Kept Activity focused on repository work rather than UI noise. |
| `4614326` | Persisted Activity in a bounded log and paginated Activity and commit history in pages of 100. | Avoided loading and rendering large histories at once. |
| `57295a6` | Read commit summaries without changes, then load changed files only when a commit expands; cache the result. | Removed eager historical tree-diff work from the initial Commits load. |
| `da7a4a6` | Validate adapter-listed paths once and reuse validated stats. | Prevented transiently stale mobile paths from aborting status walks. |
| `f66ccd2` | Batch Stage and update known staged state locally; reconcile only after failure. | Removed a full Changes scan from successful staging actions. |
| `a62f427` | Reuse one filesystem/index cache for bulk Unstage and remove Push's working-tree scan. | Reduced repeated index work and eliminated an optional vault-wide Push scan. |
| `8bbd5ce` | Added explicit remote setup, transfer, and finalization phases; removed the post-Push history walk. | Made waiting states truthful and allowed Push to finish after the server result. |
| `99361f6` | Deferred full Changes reads after Fetch, Push, Pull, Clone, commit, and related actions. | Kept remote/history updates independent from a vault-wide status scan. |
| `574633a` | Kept defensive refreshes manual when targeted reconciliation lacks ready state. | Prevented fallback code from silently starting another full scan. |

## Current read and refresh policy

### Authoritative full refresh

Initial view open, settings-driven refreshes, and the explicit Refresh control
still perform the complete local repository read. That read measures inspection,
Changes, local commits, and remote commits independently. Commit history starts
at 100 entries per source and requests one extra entry to determine whether
another page exists.

This is intentional: the full status read is the authoritative way to discover
unknown working-tree changes. It is no longer launched automatically by every
successful operation.

### Targeted and local updates

- A path-specific status read can pass only the affected paths to
  `statusMatrix`, such as the file and `.gitignore` after a gitignore change.
- Successful Stage and Unstage actions update the known file states immediately
  and retain the current Changes view, selection, and layout.
- Bulk Stage uses one `git.add` call. Bulk Unstage reuses one filesystem bridge
  and index cache across its paths.
- A failed targeted mutation marks Changes as needing refresh instead of
  pretending the local snapshot is authoritative.
- A successful commit removes the committed paths from Changes, updates the
  known branch head, and refreshes bounded commit history without a full Changes
  scan.

### Remote operations

- Fetch and Push refresh remote history only after completion.
- Pull and Clone refresh repository metadata, then show an explicit Changes
  needs-refresh state because their file effects cannot safely be inferred from
  the metadata read alone.
- Push no longer performs a working-tree status scan. The earlier warning about
  uncommitted files not being included was removed with that scan; this is an
  explicit latency-versus-extra-warning tradeoff.
- Remote phases now distinguish setup, transfer, and finalization. The UI does
  not claim byte-level upload progress when the Obsidian HTTP bridge does not
  expose it.

## What the tuning changed

The main improvement is not a single faster Git primitive. It is fewer automatic
operations on the critical path:

1. Render the initial shell promptly and measure the repository reads behind it.
2. Keep remote transport and remote-history refresh separate from local Changes
   scanning whenever the existing state is sufficient.
3. Use known-state reconciliation for successful local mutations.
4. Bound history and log reads, and defer commit file details until requested.
5. Make stale or uncertain state visible with a manual refresh action.

This preserves correctness by keeping the full scan available, while avoiding
the previous pattern where a small action implicitly repeated expensive work
across the whole vault.

## Verification and limits

- The performance changes were made in the sequence listed above and the
  production build and static diff checks were recorded as passing for the
  corresponding commits.
- The user verified the pushed mobile behavior for the progress modal, Pull,
  Push, and Changes refresh/staging interactions.
- The current branch still needs a controlled run against the large target vault
  to produce comparable cold and warm timings.
- The latency metrics are diagnostic evidence, not a promise of a fixed maximum
  duration. Remote network speed, vault size, filesystem adapter behavior, and
  Git history shape remain workload-dependent.

## Remaining work

- Capture repeated cold and warm timings from the target large vault, including
  full Refresh, manual Changes refresh, Stage/Unstage, commit expansion, Pull,
  Fetch, and Push.
- Compare the Activity phase metrics with the earlier HTTP/Pull diagnostics to
  distinguish network, Git, adapter, and rendering costs.
- Consider an incremental Changes model or filesystem watch only if measured
  full-refresh costs remain unacceptable; the current manual refresh is the
  deliberate KISS fallback.
- Keep cancellation deferred until the HTTP bridge and Git operation expose a
  tested abort path.

## Primary evidence

- `bfe42cf` — Pull and HTTP phase timing in the earlier backend.
- `7744ddb`, `8880cea` — retained rendering nodes and coalesced updates in the
  earlier T40 rendering investigation.
- `8eddbbf`, `81528f4` — clean-restart metrics and removal of noisy tab metrics.
- `4614326`, `57295a6`, `da7a4a6` — bounded history, lazy commit details, and
  stale-path handling.
- `f66ccd2`, `a62f427` — staging/index batching and Push scan removal.
- `8bbd5ce`, `99361f6`, `574633a` — truthful remote phases and deferred/manual
  Changes refresh policy.
