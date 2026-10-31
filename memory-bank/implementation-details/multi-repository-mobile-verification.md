# T16: Mobile Verification and Acceptance

*Created: 2026-10-31 13:41:41 IST*
*Last Updated: 2026-10-31 15:26:08 IST*

**State:** acceptance plan; no installed T16 mobile acceptance yet.
**Owners:** Each feature in [T16](../tasks/T16.md) and [T17](../tasks/T17.md), [T15](../tasks/T15.md) automated coverage,
and [T10](../tasks/T10.md) platform acceptance.

## Evidence Already Obtained

Host-run temporary probes used the actual ObsidianGitFs bridge bundled from
src/repository.ts, backed by a simulated DataAdapter over temporary files:

- Two vault subfolder repositories initialized and committed independently.
- Modifying one repository left the other's status clean.
- Branch creation/switching and a clean divergent merge worked; merge commit had two parents.
- Named remote addition/listing and tag creation/listing worked.
- Parent status included child files, and parent staging added a child file as ordinary content: confirmed boundary defect for this proposed feature.

These are feasibility probes, not committed regression tests, network tests,
mobile filesystem tests, or installed Obsidian acceptance. They do not establish
conflict, stash, interruption, or large-repository behavior.

## Current Automated Source Evidence — 2026-10-31

`pnpm test` passed 25 tests and the production build. New tests use a simulated
Obsidian `DataAdapter` with isomorphic-git and cover independent subfolder
repositories, provider repository IDs, local branches, index restore, parent /
child boundaries, packed refs, path safety, and write coordination. These tests
do not use a live remote or Obsidian UI.

After the user unlocked the Mac, the current working-tree build was installed
in the `typora-notes` vault and Obsidian 1.14.5 was reloaded. The plugin loaded
its schema-v2 registry and displayed the Vault root selector, Add/Clone actions,
and branch controls. The add-folder picker, clone setup form, and branch manager
opened and closed. This is installed desktop UI smoke evidence only: no second
repository was added, no Git mutation was run, and Android/iOS workflows remain
unverified. The active vault already has a Git repository at its root, so its
parent/child protection prevents using a nested folder for a live multi-repo
switching check. A follow-up Settings build now labels the selected root
“Vault root” consistently with the sidebar; this was checked after reload. The
original parent-child probe above describes pre-fix
behavior; the current regression test confirms that untracked child repository
paths are hidden from parent status and blocked from parent staging.

## Automated Cases to Add

| Area | Required behavior |
|------|-------------------|
| Data migration | Legacy settings migrate once; registry IDs stay stable; import/export round-trip excludes secrets. |
| Paths and inspection | Canonical roots, traversal rejection, missing folders, unborn/detached HEAD, packed refs, safe .git indirection. |
| Boundaries | Siblings isolate; parent/child overlap detected; ignore does not conceal already-tracked overlap; parent stage/checkout/reset cannot silently touch protected child work. |
| Operations | Queued action keeps original target across switches; UI/provider writes share coordination; late reads and completion invalidate only their repository. |
| Local Git | Init populated folder, stage deletions, commit-to-clean, branch changes with dirty files, selected restore, tags. |
| Remote Git | Default branch other than main, empty remote, auth failure, divergent push, named remotes/upstreams, shallow clone, partial clone, explicit force operations. |
| Merge | Clean divergence, text/binary/delete-modify conflict, correct parents, continue after reload, abort preconditions, unrelated local edits preserved. |
| Compatibility | Unsupported filenames/types consistently reported; no silent mode/symlink corruption; unsupported capability fails clearly. |

Use small fixtures and meaningful integration tests against isolated repositories.
Reuse T15 infrastructure and T14 state owners rather than duplicating them.
Remote network tests need a controlled test remote and separate reporting from
mocked HTTP tests.

## Acceptance by Feature

Record T16a–T16e acceptance as each core feature is implemented. Branch/tag
management and selected-file restore cases belong to T17a–T17c and do not block
T16 closeout. Merge/ref selection required to resolve divergence remains T16e.
All shared isolation, recovery, and mobile compatibility checks apply wherever
that feature reads or writes repository state.

## Installed Android and iOS Acceptance

Run the same ordinary workflow on each supported mobile platform. Record device,
OS, Obsidian version, plugin build/commit, fixture size, and observed result.

1. Upgrade existing single-repository settings; verify original repository and credential still work after reload.
2. Without a vault-root repository, init a populated folder, commit, clone a second repo, and switch between them using touch controls.
3. Verify Changes, selection, history, progress, activity, and settings always identify the right repository; switch while an operation is pending/running.
4. Exercise fetch/pull/push using two repositories with different remote credentials; verify failures do not affect the other repository.
5. Exercise branch and tag operations, selected restore, diverged history, conflict resolution, completion, and abort entirely on device.
6. Repeat parent/child cases with a vault-root repository and with a nested subfolder parent, including files already tracked by the parent.
7. Suspend/resume and restart during clone and merge resolution; inspect recovery state and retained user edits. Record transfer interruption behavior without assuming background execution.
8. Exercise unsupported filename cases on clone and update; confirm skipped/blocked paths are clear and retry does not silently destroy changes.
9. Measure representative small and large repositories: file count, binary sizes, history/pack size, cold/warm status time, UI responsiveness, and peak-memory evidence when available.
10. Reload plugin/app and verify persisted repository selection, configuration, secrets, merge recovery state, and correct repository opening for file actions.

Mark unrun device/platform cases as unverified. A build, APK installation,
simulator run, or host-backed adapter probe is not physical-device acceptance.
Use T10 to record accepted platforms; do not assume Android proves iOS.

## Completion Evidence

Maintain distinct records for source implementation, automated tests, build,
controlled remote tests, Android, iOS, and desktop regression checks. Capture
failures with repository ID/path and sanitized operation context. Do not close
T16 merely because the selector works or the automated suite passes.

See [architecture](multi-repository-architecture.md) and
[workflow limitations](multi-repository-git-workflows.md).
