# T16: Git Workflows and Backend Limits

*Created: 2026-10-31 13:41:41 IST*
*Last Updated: 2026-10-31 15:06:54 IST*

**State:** Source-level implementation is partial; automated and installed-host acceptance are tracked separately.
**Owners:** [T16](../tasks/T16.md) core repository/clone/changes/sync/merge features; [T17](../tasks/T17.md) branches, tags, and selected-file restore.
**Baseline:** installed isomorphic-git 1.41.9, inspected 2026-10-31.

## Feature Ownership

| Task | Feature subtasks |
|------|------------------|
| T16: Core work | T16a repository management; T16b clone; T16c changes/commits/history; T16d remotes/sync; T16e merging/conflicts. |
| T17: Secondary work | T17a branch management; T17b tag management; T17c selected-file restore. |

Mobile behavior, isolation, recovery, and verification are required within each
feature rather than tracked as separate subtasks. Full branch management is not
needed to merge an already selected fetched/local ref under T16e.

## Workflow Plan

| Workflow | Existing support | Required extension |
|----------|------------------|--------------------|
| Init/open | Source has add/open, populated-folder init, registry selection, and overlap checks | Installed-host workflow and reload persistence. |
| Clone | Source clones into a selected empty vault folder with branch, HTTP credential, progress, and partial-folder reporting | Remote default discovery, shallow clone, consistent mobile filename handling, retry/restart recovery, and remote acceptance. |
| Status/stage/commit/history | Repository-scoped local operations, packed-ref-aware inspection, stale history guards, and provider repository IDs; adapter tests pass | Installed UI, reload persistence, performance, and history-controller extraction. |
| Fetch/pull/push | Captured per-repository URL/credentials, shared write coordination, scoped force confirmations, and existing-origin preservation | Named remotes/upstreams and controlled remote tests. |
| Branches | Source lists/creates/switches local branches with dirty-worktree checks | Rename/delete, upstream awareness, and mobile acceptance. |
| Tags | No feature UI or operations implemented | Local/remote tag controls and tests. |
| Restore | Source restores selected files from the index with confirmation and preserves the index | Restore from arbitrary commits and installed-host acceptance. |
| Merge | No divergence/conflict workflow implemented; ordinary Pull remains fast-forward-only | Explicit merge, conflict handling, completion, recovery, and abort. |

## Merge and Conflict Lifecycle

Before merge, inspect dirty index/worktree state and refuse unsafe combinations
with an actionable message; do not silently discard or auto-stash changes.
Record exact parent commit IDs and repository/ref identity for interrupted merge
recovery. Do not rely on branch names that can change during resolution.

Use backend conflict output to present affected files. Text conflicts need edit
and resolution controls; binary and delete/modify conflicts need explicit file
choices without pretending text markers solve them. Stage resolved files and
commit with both correct parents. The current commitChanges wrapper has no
parent parameter and must be extended.

The backend exposes abortMerge, but its behavior differs from canonical Git and
has dirty-worktree caveats. Test it against the declared preconditions. Preserve
operation state across plugin reload; show continue/abort actions after restart.
Some merge strategies and multiple candidate merge bases are unsupported; report
that case without inventing a result. See [upstream merge docs](https://isomorphic-git.org/docs/en/merge)
and [abortMerge](https://isomorphic-git.org/docs/en/abortMerge). Older prose in the
installed merge declaration says abort is unavailable, despite the exported
abortMerge API; capability tests must resolve such contradictions.

## Backend Capability Limits

| Feature | Checked baseline | Planning consequence |
|---------|------------------|----------------------|
| HTTP(S) auth | Plugin and backend transport support | Keep a mobile SecretStorage/token path, scoped by repository or explicitly shared credential profile. |
| SSH | Installed transport helper map contains only http/https | Not delivered by this backend; requires a separate transport/backend effort if required. |
| Rebase | No public rebase API in installed exports | Substantial custom implementation or alternative backend; not a branch-selector feature. |
| Stash | API exists | Not safe to expose as canonical stash without remediation and tests: upstream documents tracked files only, loose objects only, and overwrite-on-apply/pop without conflict abort. |
| Submodules | Checkout implementation skips gitlink entries | Independent repositories are supported by this plan; recursive submodule management is a separate capability. |
| Linked worktrees | Backend discovers some .git indirection; plugin inspection does not | Validate common-dir/ref semantics and portable vault-relative layouts before declaring support. |
| Symlinks/executable modes | Plugin bridge rejects symlinks and reports fixed file modes | Explicit compatibility limit; do not silently claim faithful checkout/staging of these entries. |
| Git LFS | No LFS transfer/filter workflow found | Requires LFS protocol/filter implementation; pointer files are not downloaded binary contents. |
| Executable hooks | No executable-hook workflow found | Do not imply CLI hook execution; JS callback hooks are a different capability. |

[Stash documentation](https://isomorphic-git.org/docs/en/stash) states the concrete
limitations above. Recheck installed code when upgrading; documentation alone is
not acceptance. Review limits within the affected feature and create bounded
follow-ups for required gaps; advanced Git parity is not implicitly part of T16 or T17.

## Mobile Transport and Recovery

Current HTTP glue collects complete outgoing bodies and consumes response
arrayBuffer, so large pack transfers can have high peak memory. Current clone
has no depth limit; add shallow-clone selection and measure actual device limits.
Use batching/nonBlocking checkout options where supported and measured useful.

Apply one documented mobile filename policy to clone, pull, checkout, and merge.
Current pull filters certain unsupported characters, while clone calls git.clone
directly. Never report a complete usable checkout while concealing skipped files.
Detect unsupported object/file types before destructive changes where feasible.

Failed clone recovery must distinguish plugin-created partial data from existing
user files. Provide inspection/retry/cleanup actions scoped to the destination;
never blindly delete a folder. On resume/restart, inspect actual refs/index/files
before retrying. A dismissed dialog is not cancellation. Real cancellation is
only advertised when transport and Git phases support a tested abort path.

## Scope Boundary

No arbitrary shell command runner, native Git dependency, or out-of-vault access.
Creating a local repository is included; provisioning a hosted GitHub/GitLab
repository is a separate provider integration. Do not substitute force reset or
force push for ordinary divergence/conflict resolution.

See [architecture](multi-repository-architecture.md) and
[mobile verification](multi-repository-mobile-verification.md).
