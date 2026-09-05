---
source_branch: main
source_commit: 8dac512ee44e2109d9cc88d4a5c8b37f723af37d
---

# Obsidian Git Sync Plugin — Rewrite Product Requirements Document

*Created: 2026-09-04 11:05:03 IST*
*Last Updated: 2026-09-04 20:18:35 IST*
*Status: Draft for user review*
*Source: [Current Product Specification](product-spec.md)*

## 1. Purpose

This PRD defines the product requirements for a fresh implementation of
Obsidian Git Sync. It is derived from the current product specification and
describes the behaviour and UI the replacement must provide.

The implementation may be entirely new. The current source structure is not a
requirement and is not used as the design model for the replacement.

## 2. Product decision

The replacement must retain the existing product surface and visible layouts:

- Git sidebar with Changes, Commits, and Log tabs.
- Current Settings panel design and its six sections.
- Existing commands, ribbon actions, notices, menus, dialogs, and progress
  presentation.
- Local-only and remote Git operation.
- Desktop and mobile behaviour already present in the product.

No current UI element has been identified for removal. Any proposed removal or
layout change requires a separate product decision.

### UI-preserving mechanics rewrite

The rewrite is not a replacement of every part of the plugin. It is a
UI-preserving replacement of the Git and repository mechanics plus the path by
which completed results reach the UI.

The existing Settings panel, sidebar layout, styles, labels, dialogs, menus,
and progress presentation are the baseline to carry forward. They may be
reused directly where they already satisfy this PRD.

The replacement must provide direct, understandable paths for the actual user
actions: read state, stage, unstage, commit, pull, push, sync, initialize,
clone, history, health, and repair. Git work must return clear state and
operation results; the UI must present those results and remain responsible for
its own layout and messages.

Keep the handoff between Git work and the UI direct. A small shared helper may
be used when it removes demonstrated duplication, but this PRD does not require
a coordinator, event system, read-model module, cache store, or any other
particular collection of implementation modules.

## 3. Goals

- Give users dependable Git tracking for an Obsidian vault.
- Make ordinary Git actions understandable and directly visible.
- Preserve the current product's tested and observed Git behaviour.
- Preserve the current Settings and sidebar experience.
- Work within Obsidian desktop and mobile constraints.
- Keep failures, partial results, cancellation, and recovery understandable.
- Keep the fresh implementation small enough that each user action has an
  obvious path and a clear result.

## 4. Non-goals

- Adding new product features not present in the current product.
- Adding multi-branch visualisation; the existing branch-tree idea is deferred.
- Reproducing current source files, classes, call chains, or ownership paths.
- Preserving implementation details that users cannot observe.
- Treating automated tests as a substitute for device or live-remote checks.

## 5. Users and primary journeys

### First setup

1. User opens the Git sidebar or Git Sync Settings.
2. The product reports whether the vault has a local repository.
3. User enters a remote URL, branch, author details, and credential when
   remote synchronization is wanted.
4. User may test the remote connection without changing the vault.
5. User explicitly chooses local initialization or remote cloning.
6. The product reports the resulting repository state.

### Daily local work

1. User opens Changes.
2. The product shows staged and uncommitted files.
3. User stages selected files or all visible changes.
4. User commits staged files with a recognisable message.
5. The product updates Changes and Local history.

### Daily remote work

1. User chooses Pull, Push, or the retained ribbon/command-palette Sync now.
2. The product shows progress where the operation supports it.
3. The product reports success, no changes, conflict, cancellation, or
   failure.
4. The sidebar reflects the resulting branch and file state.

### Troubleshooting

1. User opens Settings, Diagnostics, or Maintenance.
2. The product shows health, diagnostic, storage, or log information.
3. User can run a read-only preview before an available repair action.
4. The product explains what was changed, preserved, or unavailable.

### Updating

1. The product checks the selected release channel on startup when enabled,
   or the user checks manually.
2. The product reports current, available, missing, or failed update state.
3. User confirms development updates and any prompted installation.
4. The product installs safely, reports failure if it cannot, and tells the
   user when a reload is required.

## 6. UI requirements

### PRD-UI-01: Sidebar shell

The replacement must provide the existing right-sidebar shell with:

- A tab bar for Changes, Commits, and Log.
- A repository header showing branch/repository state and a contextual action.
- A scrollable content region.
- A footer shown only for Changes actions.

The selected tab, expanded sections, expanded commits, busy controls, and
loading/error states must be visibly and accessibly identifiable.

### PRD-UI-02: Changes

The replacement must retain the two collapsible sections, counts, bulk actions,
file rows, status markers, per-file staging controls, file menus, and fixed
footer actions described in `product-spec.md`.

The visible result of stage, unstage, commit, pull, push, and refresh must
reflect the completed operation. A control must not imply success before the
operation has succeeded.

### PRD-UI-03: Commits

The replacement must retain Local/Remote selection, commit rows, timeline
markers, message/date/hash/author metadata, local/origin badges, expandable
file details, and the documented empty and unavailable states.

Remote history must remain usable when local history is absent or unhealthy,
provided the configured remote and credentials allow it.

### PRD-UI-04: Log

The replacement must retain the Activity view, retained current and persisted
entries, level and timestamp display, detail display, and Export log, Clear log,
and Copy details actions.

### PRD-UI-05: Settings

The replacement must retain the `Git Sync Settings` heading, Sections table of
contents, six expandable sections, section descriptions, saved open/closed
state, control labels, defaults, and action placement.

### PRD-UI-06: Dialogs and menus

The replacement must retain the current Commit, `.gitignore` editor, ignore
pattern, update, available-build, diagnostics, maintenance, and progress
dialog experiences. Confirmation must remain required for force push, index
repair, and index-backup restore.

### PRD-UI-07: Responsive behaviour

The replacement must remain usable in narrow Obsidian sidebars and mobile
WebViews. Text, buttons, scroll regions, modal controls, and the focused
`.gitignore` editor must remain accessible when the mobile keyboard changes the
visible viewport.

## 7. Settings requirements

The replacement must provide the following saved settings and defaults:

| Requirement | Default |
|---|---|
| Repository URL | Empty |
| Branch | `main` |
| Username | Empty |
| Author name | Empty |
| Author email | Empty |
| Auto-sync interval | `0` minutes, disabled |
| Automatic commit message | `Vault backup: {{date}}` |
| Sidebar refresh interval | `60` seconds |
| Check for updates on startup | Enabled |
| Release channel | Stable |
| Auto-install stable updates | Disabled |
| Debug log level | Errors only |
| Debug log retention | Approximately 200 entries |
| Debug log maximum size | 5 MB |

Credential values must be stored securely and must not be displayed when the
Settings panel is reopened. A blank credential field retains the current
credential unless the user explicitly clears it.

Changing the auto-sync interval must enable, replace, or disable the scheduler
without requiring a plugin restart. Changing the sidebar refresh interval must
take effect in an open sidebar. The first `{{date}}` placeholder in an
automatic commit message must expand to the current local date and time.

The startup update check must not run more than once per day for the recorded
check time. Stable and Dev channels must remain distinguishable. Stable
auto-install must never silently apply a development build.

## 8. Functional requirements

### PRD-FN-01: Repository setup

The replacement must support explicit local initialization, local
initialization with a configured remote, and cloning the configured branch from
the configured remote. It must distinguish a missing repository, a repository
with no commits, a local-only repository, a healthy repository, and damaged
repository metadata.

Ordinary refresh, automatic sync, and normal sync must not create a repository
in a fresh vault.

### PRD-FN-02: Status

The replacement must show the current branch, staged files, uncommitted files,
ahead/behind information when available, local-only state, up-to-date state,
and comparison-unavailable state.

Status must recognise added, modified, deleted, untracked, ignored, and
tracked-but-ignored files using the product's existing Git behaviour.

### PRD-FN-03: Staging

The replacement must support individual stage/unstage and bulk Stage all/
Unstage all actions. Ignored untracked files must not be reported as staged.
Tracked-but-ignored files must remain eligible for manual staging.

Bulk actions must continue through individual failures, move only successful
files, and report the completed and failed counts.

### PRD-FN-04: Commit

The replacement must commit staged files using the entered message. An empty
message must use the configured automatic message. The Commit action must be
disabled or rejected when no files are staged.

### PRD-FN-05: Pull and push

The replacement must pull from and push to the configured remote and branch.
It must report an already-up-to-date result, remote rejection, conflict,
authentication failure, permission failure, invalid URL, network failure, and
other operation failure when those conditions occur.

Force push must remain available through the existing contextual action and
must require explicit confirmation before overwriting remote history.

### PRD-FN-06: Sync

The retained ribbon/command-palette Sync now and automatic sync must pull first when a remote is configured, then
stage local changes, commit when changes exist, and push when a remote exists.
Without a remote, sync must create a local commit only. With no changes, it
must report that there are no changes to commit.

### PRD-FN-07: `.gitignore`

The replacement must allow the user to open and edit the hidden `.gitignore`,
add a pattern, ignore an individual file, detect duplicate patterns, and
reject blank or comment-only patterns. Tracked or staged files added to the
ignore file must remain visible in Changes.

### PRD-FN-08: History

The replacement must show up to 25 local commits and up to 25 remote commits
for the selected branch. It must allow commit expansion and show added,
modified, and deleted file details when available.

Remote history and commit details must remain available through the documented
GitHub fallback when local repository objects cannot provide them. Shallow
history limitations must produce the documented unavailable-details message.

### PRD-FN-09: Diagnostics and logs

The replacement must record diagnostics at the selected level, retain entries
within the configured limits, redact credentials and sensitive values, load
persisted entries, and provide export, clear, and copy actions.

The compatibility diagnostic must report the platform, available runtime and
filesystem checks, repository detection, and temporary Git initialization
result. The temporary test must be cleaned up when the runtime permits it.

### PRD-FN-10: Maintenance

The replacement must provide repository health, index-repair dry run, index
repair, index-backup preview, index-backup restore, and remote comparison
preview. Dry runs must not change vault or repository files.

Index repair must preserve vault files and must clearly state that staged
changes from a damaged index cannot be recovered. Backup restore must save the
current index first. Remote comparison must report conflicts, remote-only,
local-only, and unchanged files without changing either side.

### PRD-FN-11: Progress and cancellation

Clone and push must present the existing progress information where available,
including phases, counts, data, rate, ETA, files, written bytes, elapsed time,
success, and failure. Closing an active progress dialog must request
cancellation, and cancellation must not later become a success notice.

### PRD-FN-12: Updater

The replacement must check the selected release channel, show current or
available versions, list published builds, download and install a selected
build, and retain rollback behaviour for failed installation.

Stable updates may auto-install when enabled. Development updates must always
require confirmation. Missing releases, unavailable assets, failed requests,
failed installation, and failed rollback must be reported as failures rather
than as an up-to-date result.

The updater must retain the proven `obsidian-ai`-derived behaviour already
present in the product: cache-busted and status-validated requests, useful
manual-check errors, embedded branch/commit identity, matching
`latest-dev-<branch>` selection with rolling-main fallback, all published
stable and development builds, direct assets and ZIP assets, bounded requests,
stale temporary-directory cleanup, transactional installation, rollback, and
permissive handling of optional release metadata.

## 9. Platform and data requirements

### PRD-PL-01: Obsidian storage

The replacement must use the Obsidian vault storage available on desktop and
mobile. Hidden `.gitignore` content and Git metadata must remain usable even
when Obsidian's indexed file list does not expose them.

### PRD-PL-02: Mobile resource limits

Clone, pull, push, checkout, and status operations must remain safe in a mobile
WebView. Large Git responses must not cause the mobile runtime crash already
encountered by the product. Progress information must not claim more accuracy
than the available transport data supports.

### PRD-PL-03: Mobile editor usability

The `.gitignore` editor must respond to keyboard and visual-viewport changes.
The text area, Save, and Cancel actions must remain usable when the keyboard
is open.

### PRD-PL-04: Credential safety

Credentials must be stored in secure Obsidian storage, resolved only when
needed for remote work, and excluded from notices, logs, exports, URLs, and
error details.

### PRD-PL-05: Protected automatic scope

Automatic sync must not stage the plugin's own protected files. This rule must
not prevent a user from manually staging ordinary tracked files that Git
reports as ignored.

## 10. KISS requirements for the fresh implementation

These are constraints on the new implementation, not a description of the
current product.

KISS means “Keep It Simple, Stupid.” The implementation should contain only
the machinery needed to provide the documented user behaviour.

- Start from the user-visible requirements in this PRD.
- Keep one straightforward path for each user action.
- Give each piece of behaviour one clear owner.
- Keep state close to the feature that displays or changes it.
- Prefer direct data flow over indirect callbacks and duplicated refreshes.
- Add an abstraction only when it removes demonstrated repetition or makes a
  required platform difference genuinely simpler.
- Do not add configuration, extension points, or alternate paths that the
  current product does not require.
- Do not preserve an old implementation detail solely for familiarity.
- Keep user-facing errors and results explicit.
- Make the smallest change needed to satisfy a requirement.
- Do not add a global operation event system, a dedicated sidebar cache, or
  source-structure checks unless a specific observed failure shows that the
  simpler direct implementation cannot work.

The acceptance target is behavioural equivalence with the product
specification, not structural similarity to the current source.

## 11. Acceptance requirements

The rewrite is acceptable only when all of the following are true:

- Every requirement in Sections 6–9 has an automated or runtime acceptance
  check appropriate to its evidence level.
- The sidebar matches the approved Changes, Commits, and Log layouts.
- The Settings panel retains its six-section structure, labels, defaults, and
  saved section state.
- Every command and ribbon action has been exercised.
- Local-only, empty, healthy, damaged, and remote-backed repository states
  have been exercised.
- Staging, tracked-ignore, ignored-untracked, deletion, partial bulk failure,
  commit, pull, push, force push, and sync behaviour have been exercised.
- Cancellation and competing-operation behaviour have been exercised.
- `.gitignore`, logs, diagnostics, maintenance, and updater flows have been
  exercised.
- Desktop, Android, and any claimed iOS support have separate evidence.
- Live remote authentication and repository access have been tested without
  exposing credentials.
- The current implementation remains available for rollback until parity is
  demonstrated.

These acceptance requirements describe user-visible behaviour. They do not
require a named coordinator, lifecycle event bus, sidebar read model, AST
conformance test, or any other specific internal structure.

### Evidence layers

| Layer | What it proves | What it does not prove |
|---|---|---|
| Unit and integration tests | Deterministic product rules and Git fixtures | Obsidian rendering or device behaviour |
| Build and artifact checks | The replacement can be packaged consistently | GitHub access or user experience |
| Obsidian desktop | Desktop UI, storage, and operation behaviour | Android/iOS behaviour |
| Android | Mobile storage, keyboard, resource, and Git behaviour | Desktop parity by itself |
| iOS, if supported | iOS-specific claimed behaviour | Android behaviour |
| Live remote | Authentication, access, branch, pull, push, and remote history | Offline/local-only behaviour |
| User review | Product and visual approval | Hidden implementation correctness |

No single layer may be used as proof for another layer.

## 12. Rewrite handoff

The next session begins with creation of the rewrite task as the new origin
task. That task should link to this PRD and `product-spec.md`, establish the
new branch, and define the replacement acceptance work.

The rewrite task must not be made a child of the current architecture-
assessment task. It is a new product implementation effort based on the
approved requirements in this document.

The current plugin, its release artefacts, and its source branch remain the
comparison and rollback baseline until the replacement passes the acceptance
requirements above.

## 13. Review status

This PRD is complete as a first draft derived from the current product
specification. User review is required before it becomes the final rewrite
contract. Review comments should change product requirements or acceptance
criteria here, not introduce current source structure.
