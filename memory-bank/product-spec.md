---
source_branch: main
source_commit: 8dac512ee44e2109d9cc88d4a5c8b37f723af37d
---

# Obsidian Git Sync Plugin — Current Product Specification

*Created: 2026-09-04 11:05:03 IST*
*Last Updated: 2026-09-04 11:36:55 IST*
*Status: Current product baseline for PRD preparation*

## Purpose

This document records the product as it currently exists. It is the source for
the later rewrite PRD. It describes user-visible features, UI, settings,
platform behaviour, and evidenced edge cases. It does not prescribe the
current implementation or its internal structure.

## Authority and evidence

The current source, automated tests, approved UI mockups, Memory Bank records,
and recorded desktop/mobile observations were used to assemble this baseline.
Where behaviour is implemented but not verified on a real device, that is
stated explicitly.

Evidence labels used below:

- **Source** — present in the current product source.
- **Automated** — covered by the current automated checks.
- **Desktop** — observed in a real Obsidian desktop runtime.
- **Mobile** — observed in a real Obsidian mobile runtime.
- **Open** — present or attempted, but acceptance is incomplete.

## Product scope

Obsidian Git Sync is an Obsidian plugin that tracks a vault with Git. It
supports local repository work, configured remote repositories, manual and
automatic synchronization, repository inspection and repair, activity
diagnostics, and plugin updates.

The product supports Obsidian desktop and mobile. The visible product is
primarily the Git sidebar and the Git Sync Settings panel, with commands,
ribbon actions, notices, and modal dialogs providing the remaining entry
points.

The current product uses a configured branch, defaulting to `main`. It may be
used without a remote for local-only Git history. A remote URL and credentials
are required for remote connection, pull, push, clone, and remote history.

## Product entry points

| Entry point | Available action |
|---|---|
| Git ribbon icon | Run a manual sync |
| Git branch ribbon icon | Open or reveal the Git sidebar |
| Command palette | Run the commands listed below |
| Git sidebar | View changes, commits, activity, and Git actions |
| Obsidian Settings | Configure Git Sync, diagnostics, and maintenance |
| Automatic scheduler | Run configured automatic syncs |
| Startup updater check | Check for a plugin update once per day when enabled |
| Status bar | Show the current high-level Git status |

### Command palette commands

- Check for plugin updates
- Sync now
- Pull from remote
- Push to remote
- Show repository status
- Preview repository rebuild
- Repair Git index from HEAD
- Restore latest Git index backup
- Run compatibility diagnostics
- Open Git sidebar
- Open `.gitignore`
- Export debug logs
- Clear debug log file

## Sidebar layout

The Git sidebar opens in Obsidian's right sidebar. It has one stable shell:

1. Tab bar
2. Repository header
3. Scrollable content area
4. Changes-only action footer

The tab bar contains `Changes`, `Commits`, and `Log`. The selected tab is
visually indicated and exposed as the selected tab to assistive technology.
Changing tabs refreshes the selected view without changing the repository.

The repository header shows a Git branch icon, the active branch or a local/no
repository label, a tab-specific action button, and a status line. Depending
on the state it can show:

- Loading repository.
- No Git repository — initialize to create.
- Git repository detected — initialize to sync.
- Local only — no remote.
- Repository comparison unavailable.
- Local commits not pushed.
- Commits to pull.
- Up to date.

The header action is refresh on `Changes`, refresh-history on `Commits`, and a
log-actions menu on `Log`.

The content area owns the sidebar list scrolling. The Changes footer remains
available at the bottom of the Changes tab and is hidden on the other tabs.
The Local/Remote selector remains available while the commit list scrolls.

### Changes tab

The Changes tab contains two collapsible sections:

- **Staged** — files currently staged for commit.
- **Uncommitted Changes** — changed, added, deleted, or untracked files not
  currently staged.

Each section shows a count, a collapse/expand control, and a bulk action. The
Staged section offers `Unstage all`; the Uncommitted Changes section offers
`Stage all`. Empty sections remain visible and say `No staged files` or `No
uncommitted changes`.

Each file row contains:

- A stage or unstage toggle.
- A status marker: `A`, `M`, or `D`.
- The file path, with the full path available as its title.
- A More actions menu.

The file menu offers `Ignore this file` when the row is not `.gitignore`, and
always offers `Edit .gitignore`. During a staging mutation, staging controls
are disabled and marked busy. A completed action updates the visible Changes
state and reports the result with a notice.

The Changes footer contains:

- `Commit (n)` — disabled when no files are staged.
- `Pull` — disabled when no remote is configured.
- `Push` — disabled when no remote is configured.
- `More` — opens `.gitignore`, ignored-pattern, and force-push actions.

### Commits tab

The Commits tab contains a `Local` / `Remote` selector and a chronological
commit list. Each commit row shows:

- A timeline marker.
- A shortened commit message, with the full message as a title.
- Relative or calendar date information.
- A shortened commit identifier, with the full identifier as a title.
- Author.
- A `local` or `origin` badge.
- An expand/collapse indicator.

Clicking the commit row expands or collapses its file details. Expanded details
show added, modified, or deleted file paths. Local history comes from the
local repository. Remote history can be viewed independently when a remote
URL is configured, including when the local repository is absent or unhealthy.

The view requests up to 25 commits. Empty states include:

- No local repository — initialize or clone to see local commits.
- No commits yet — stage files and commit to create the first commit.
- No remote URL configured.
- No remote commits found on the selected branch.
- Commit details unavailable locally.
- Unable to read commit history.

### Log tab

The Log tab is titled `Activity`. Each retained entry shows its time, level,
message, and available detail data. The tab includes entries loaded from the
persisted debug log as well as the current session, subject to the configured
retention limit.

The Log actions menu contains:

- `Export log` — writes the retained log to a Markdown file in the vault.
- `Clear log` — clears the in-memory and persisted activity log.
- `Copy details` — copies the retained entries and details to the clipboard.

When there are no entries it shows `No activity yet`.

### Uninitialised and unavailable states

When no local repository is found, the sidebar explains that the vault has no
Git repository and offers `Initialize New Repo`. If a repository URL is set,
it also offers `Clone Remote`.

When a local repository is detected but is not yet usable for synchronization,
the sidebar explains that the repository exists and offers `Initialize Local`.
If a remote URL is set, `Clone Remote` is also available. The description
distinguishes local tracking from remote synchronization.

The Changes view can report that status is temporarily unavailable when a pack
index cannot be read. It provides a retry action and explains that rebuilding
pack files with Git or using the command line may be needed. Other status
failures show an error state and a retry action.

### Commit dialog

Selecting `Commit (n)` opens a dialog titled with the number of staged files.
It contains a commit-message field, `Cancel`, and `Commit`. The field uses
the automatic commit message with `{{date}}` expanded as its placeholder. An
empty message uses that same default. Enter submits the commit. While the
commit is running, the action is disabled and says `Committing…`.

### Progress dialog

Clone and push operations can show a progress dialog. It presents the current
status, elapsed time, operation phases, progress bars where totals are known,
object counts, data or response data, rate, ETA, files, and bytes written.
Closing an active dialog requests cancellation. Completed dialogs stop their
timer and show success; failed dialogs show the failure message and failed
phase.

### `.gitignore` dialogs

`Edit .gitignore` opens an editor even though Obsidian may hide dotfiles from
its file index. The editor reads and writes the vault's `.gitignore` directly.
It opens with a loading, disabled text area, then enables editing when the
content is available. It has `Cancel` and `Save`; saving writes the complete
text and closes the dialog. Loading or saving failures remain visible through
a notice.

`Manage ignored patterns` opens an `Add .gitignore pattern` dialog. It accepts
a non-empty pattern, rejects blank values and comment-only values, reports
when a pattern already exists, and appends new patterns with a trailing line
break. Enter submits the dialog.

`Ignore this file` adds a file-specific pattern. An untracked file should
disappear from Changes after refresh when Git ignores it. A tracked or staged
file remains in Changes and the notice explains why.

### Notices and confirmations

Git actions report completion and failure through Obsidian notices. Destructive
or potentially irreversible actions require confirmation:

- Force push warns that remote history will be overwritten.
- Repairing the index warns that staged changes from a damaged index cannot be
  recovered while vault files are preserved.
- Restoring an index backup warns that the current index is saved first.

The product does not treat a cancelled confirmation as an error.

### Status bar

The plugin adds a status-bar item with a ready state and updates it while Git
operations report progress or failure. The status bar is optional on mobile;
the sidebar and notices remain the primary visible status surfaces there.

## Settings panel

The Settings panel is headed `Git Sync Settings`. It contains a `Sections`
table of contents followed by six expandable sections. Sections are open by
default and remember their open/closed state.

### General

| Setting | Control | Default | Behaviour |
|---|---|---:|---|
| Repository URL | Text | Empty | Remote repository address |
| Branch | Text | `main` | Branch used for synchronization |
| Author Name | Text | Empty | Name recorded on commits |
| Author Email | Text | Empty | Email recorded on commits |

The Repository URL placeholder is a Git HTTPS URL. The URL must not contain
embedded credentials. The branch and author values are saved when changed.

### Authentication

| Setting | Control | Default | Behaviour |
|---|---|---:|---|
| Username | Text | Empty | Optional Git username when using a token |
| Password / Personal Access Token | Password text plus show/hide control | Empty display | Adds, replaces, or clears the saved credential |

The credential field is not repopulated with the secret. Leaving it blank
keeps the current credential. Entering a value stores it in Obsidian secure
storage. Entering an empty value clears it. The eye control toggles visibility
of the value being entered.

### Sync

| Setting | Control | Default | Behaviour |
|---|---|---:|---|
| Auto Sync Interval | Text number | `0` minutes | Automatic sync; zero disables it |
| Auto Commit Message | Text | `Vault backup: {{date}}` | Message for automatic commits |
| Sidebar Refresh Interval | Text number | `60` seconds | Automatic sidebar refresh; zero disables it |
| Test Connection | Button | — | Tests remote URL and credentials without changing the vault |
| Manual Sync | Ribbon icon / command palette | — | Runs the retained manual sync entry point |

The automatic commit message expands the first `{{date}}` placeholder to the
current local date and time. Non-negative numeric intervals are accepted. A
manual connection test reports missing URL, success, or failure and does not
clone, initialise, or modify the vault.

### Updates

| Setting | Control | Default | Behaviour |
|---|---|---:|---|
| Check for updates on startup | Toggle | Enabled | Checks GitHub at most once per day |
| Release channel | Dropdown | Stable | Selects Stable or Dev (pre-release) builds |
| Auto-install stable updates | Toggle | Disabled | Installs stable updates without prompting |
| Available builds | Button | — | Opens all published stable and development builds |
| Current plugin version | Button | — | Shows version, channel, short commit, and `Check Now` |

Development updates always require confirmation. A manual check reports when
the plugin is current, when an update is available, or when checking fails.
The last-check time is displayed when one has been recorded. Installation
requires an Obsidian reload to apply.

### Diagnostics

The Diagnostics section contains:

- `Export Debug Logs` with an `Export Logs` button.
- `Debug log level`: Off, Errors only, Info, or Debug.
- `Debug log max size (MB)`, defaulting to 5 MB.
- `Debug log retention`, defaulting to approximately 200 lines.
- Metrics for JavaScript heap used, total heap, heap limit, DOM nodes, plugin
  storage, and a storage breakdown.
- `Refresh metrics` with a `Refresh` button.

The storage breakdown can include runtime files, logs, backups, temporary
files, settings, and other files. Heap information is unavailable where the
runtime does not expose it. Plugin storage metrics are unavailable on mobile
when the desktop filesystem is not available.

`Run compatibility diagnostics` opens a plain-text report containing the
platform, runtime capabilities, filesystem checks, `.git` detection result,
and a temporary Git initialisation test. The test repository is removed after
the check when cleanup is available.

### Maintenance

Maintenance begins with an automatic repository-health read and provides a
`Run health check` button. The result distinguishes no repository, a damaged
repository, and a healthy repository with or without commits.

The section also provides:

- `Repair Git index from HEAD`: `Dry run` and `Repair index`.
- `Restore index backup`: `Preview restore` and `Restore latest backup`.
- `Remote repository rebuild`: `Preview comparison`.

Dry runs are read-only and show counts before an action. Index repair preserves
vault files but cannot recover staged changes from a damaged index. Remote
comparison reports conflicts, remote-only files, local-only files, and
unchanged files without changing either side.

## Git and repository behaviour

### Repository setup

`Initialize New Repo` creates local Git tracking in the vault. `Initialize
Local` does the same when a repository is already detected but is not yet
connected to the configured remote. `Clone Remote` starts from the configured
remote and branch.

Normal refresh, automatic sync, and ordinary sync do not create a repository
in a fresh vault. Repository creation is an explicit user action.

The product recognises these user-visible repository situations:

- No local repository.
- Local repository without a configured remote.
- Local repository with a configured remote.
- Repository with no commits yet.
- Healthy repository.
- Damaged repository metadata.
- Remote repository that is empty.
- Remote repository that cannot be reached or accessed.

### Status and changes

The Changes tab shows the current staged and uncommitted file lists. It
recognises added, modified, deleted, untracked, ignored, and tracked-but-
ignored files according to Git's status rules.

Stage and unstage actions apply to individual files or to all files in the
visible section. Bulk actions continue through individual file failures and
report the number completed and the first failure. A completed action updates
the visible lists without falsely reporting a file as changed when it is no
longer present.

Automatic sync excludes the plugin's own protected files from automatic
staging. Manual file actions remain separate from this automatic protection.

### Commit, pull, push, and sync

`Commit` operates on staged files. It uses the entered message, or the
automatic commit message when the field is empty. A successful commit clears
those staged changes from the Changes view and makes the commit available in
local history.

`Pull` retrieves changes from the configured remote and updates the vault. It
can report that the repository is already up to date, or report a conflict or
remote failure. `Push` sends local commits to the configured remote. A force
push is available through More and requires explicit confirmation because it
overwrites remote history.

The retained ribbon and command-palette `Sync now` actions and automatic sync
perform the combined workflow of pulling first,
staging local changes, committing them when present, and pushing when a remote
is configured. With no remote, sync creates a local commit only. With no
changes, it reports that there are no changes to commit.

Pull, push, and remote sync require a configured remote and usable
credentials. An active Git operation prevents competing Git mutations.

Closing an active progress dialog or unloading the plugin requests
cancellation. A late result must not be reported as a successful operation.

### History and remote fallback

Local history displays up to 25 commits from the local repository. Remote
history displays up to 25 commits from the configured branch and remains
available when local Git history cannot be read. For supported GitHub URLs,
remote commit and file details can be obtained from GitHub when local objects
are missing or the local repository is unhealthy. Other remotes use available
remote Git history.

### Repository errors

The product distinguishes these remote failure classes when the available
error information allows it:

- Authentication failure.
- Permission denial or inaccessible repository.
- Invalid repository URL.
- Network or connection failure.
- Empty remote repository.
- Unknown repository failure.

The user receives a plain-language failure notice. Credentials are not shown
in notices or diagnostic output.

## Platform behaviour

The product uses the Obsidian vault storage available on both desktop and
mobile. Desktop may use the local filesystem for repository detection and
storage metrics. Mobile uses the Obsidian vault adapter and supplies the
runtime support needed by Git operations.

The product must preserve these platform-visible behaviours:

- A fresh mobile vault must not be initialised by an ordinary refresh or
  automatic sync.
- Hidden `.gitignore` content must remain editable on mobile.
- Clone and Git transfer operations must not crash because a response is too
  large for a mobile WebView.
- Progress cancellation must reach the active operation.
- Existing mobile repositories must report their actual branch and refs.
- Mobile keyboard and viewport changes must keep editor actions usable.

The first four behaviours have source and automated coverage at different
levels. Android acceptance remains open for the existing repository reference
failure and for keyboard overlap in the `.gitignore` dialog.

## Diagnostics and data handling

The plugin records diagnostic entries at the selected level and retains them
in the plugin-scoped debug log within the configured size and retention
limits. Sensitive values, credentials, authorization data, and embedded URL
credentials are redacted from logs and exported details.

The Log tab combines current and persisted entries, while export writes a
Markdown copy to the vault. Clearing the log clears both the visible history
and the persisted log file. Metrics are read on demand and are not presented
as a guarantee that every runtime exposes heap or storage information.

## Updater behaviour

The updater checks GitHub releases for the selected Stable or Dev channel. It
recognises the installed plugin version and source commit, lists available
published builds, downloads a selected release, installs it transactionally,
and retains rollback behaviour when installation fails.

Stable updates may be installed automatically when that setting is enabled.
Development updates always require user confirmation. A successful install
reports that Obsidian must be reloaded. A missing release, failed request,
invalid asset, failed installation, or failed rollback is reported as an
update error rather than as “up to date”.

The current updater follows the proven release pattern used by the local
`obsidian-ai` implementation. The behaviours to carry forward are:

- Cache-busted release and asset requests with HTTP-status validation.
- Retention of useful GitHub error details for manual checks.
- Build branch and commit identity for development-build selection.
- Matching `latest-dev-<branch>` selection with rolling-main fallback.
- Discovery of stable, rolling-development, and branch-development builds.
- Direct plugin assets and ZIP assets.
- Bounded metadata, asset, and vault operations.
- Removal of stale `.update-tmp-*` directories before retrying.
- Transactional installation and rollback on failure.
- Permissive handling of older or incomplete optional release metadata.

These are updater safety and compatibility requirements, not a requirement to
copy the `obsidian-ai` source structure.

## Actual edge cases

This section records only conditions already present in the product source,
tests, or recorded user/runtime work. It is not a list of hypothetical future
requirements.

| Condition | User-visible result | Current evidence |
|---|---|---|
| No `.git` repository | Initialization message and `Initialize` action | Source; automated |
| `.git` exists but is not ready to sync | Local repository message and initialize/clone actions | Source |
| No remote URL | Local-only status; Pull and Push disabled | Source |
| Empty repository | No commits message; local commit remains available | Source; automated |
| Empty remote | Empty-remote failure classification and notice | Source; automated |
| Invalid remote URL | Invalid URL failure notice | Source; automated |
| Authentication rejected | Authentication failure notice | Source; recorded Android/live evidence |
| Remote access denied | Permission failure notice | Source; automated |
| Network or timeout failure | Network failure notice | Source; automated |
| Missing local branch/ref | No-commits or repository failure state, depending on operation | Source; recorded Android evidence |
| Damaged Git index | Health warning; repair dry run and repair action | Source; automated; desktop path |
| Repair index confirmation cancelled | No repair is performed | Source |
| Latest index backup absent | Preview reports no backup | Source |
| Tracked file is ignored | File remains eligible for manual staging | Source; automated |
| Untracked file is ignored | File is rejected from staging and can disappear from Changes | Source; automated |
| Tracked or staged file is added to `.gitignore` | File remains in Changes with an explanatory notice | Source |
| Duplicate ignore pattern | No duplicate is added; notice reports it already exists | Source |
| Blank or comment-only ignore pattern | Pattern is rejected | Source |
| File deleted after status read | Staging and refresh handle the deletion rather than reporting a false success | Source; automated |
| Bulk stage/unstage partial failure | Successful files move; failed files are reported | Source; automated |
| Commit with empty message | Configured automatic message is used | Source |
| Commit with no staged files | Commit is disabled or a notice asks the user to stage a file | Source |
| Force push | Confirmation is required before remote history can be overwritten | Source |
| Active operation | Git mutation controls are disabled; competing mutation is not started | Source; automated |
| Operation cancelled or plugin unloaded | Operation does not later report success | Source; automated |
| Remote history with no healthy local repository | Remote commits can still be browsed when URL/credentials allow | Source |
| Remote commit files unavailable locally | GitHub fallback is attempted for supported remotes | Source; automated |
| Shallow history lacks commit details | Empty/unavailable details message is shown | Source |
| Persisted and live log entry overlap | Duplicate visible entries are removed | Source; automated |
| No retained log entries | `No activity yet` is shown | Source |
| Log export or clipboard failure | Failure notice is shown | Source |
| Desktop heap/storage metric unavailable | Metric shows `N/A` or filesystem-unavailable text | Source |
| `.gitignore` load failure | Editor remains unavailable and a notice is shown | Source |
| `.gitignore` save failure | Editor remains open, Save is re-enabled, and a notice is shown | Source |
| Mobile keyboard changes viewport | Editor attempts to resize and scroll into view; Android acceptance remains open | Source; recorded Android evidence |
| Update check finds no release | Manual check reports failure rather than falsely claiming current status | Source |
| Stable update available with auto-install enabled | Update downloads and installs, followed by a reload notice | Source |
| Development update available | User confirmation is required | Source |
| Update installation failure | Installation/rollback path reports failure | Source; automated |

## Evidence and acceptance status

The current automated verification passes the production build, artifact
checks, 72 Node tests, 10 isomorphic-git checks, and `git diff --check` at the
source snapshot named above. These checks do not substitute for real Obsidian
desktop, Android, iOS, or live remote acceptance.

Known open product acceptance items are:

- Android cannot currently resolve `refs/heads/main` in the existing
  non-empty `typora-notes` repository.
- Android still reports keyboard overlap in the `.gitignore` editor.
- Full real-Obsidian visual acceptance of the sidebar remains open.
- Credential setup, replacement, and clearing need mobile acceptance.
- Updater installation and reload need real desktop/mobile acceptance.
- Protected remote repository replacement is not implemented as a completed
  product flow.

These are recorded as current acceptance facts, not proposed features.

## PRD handoff

The later rewrite PRD must be derived from this product specification after
review. It should preserve the documented UI and user-visible behaviour while
allowing the implementation to be replaced completely.

The PRD must not copy the current code structure. It should contain only:

- Product goals and non-goals.
- User journeys and feature requirements.
- UI and Settings requirements.
- Actual edge-case acceptance criteria.
- Desktop and mobile acceptance criteria.
- Data and credential handling requirements visible to the user.
- KISS constraints for the fresh implementation.
- Migration, rollback, and release acceptance.

The rewrite task will be created as the new origin task in the next session.
This current document task is only the product baseline and PRD foundation.

## Evidence sources

- `src/main.ts` — plugin entry points, commands, settings, scheduler, notices,
  credentials, diagnostics, and `.gitignore` editor.
- `src/views/GitSidebarView.ts` — sidebar layout, tabs, actions, states, and
  commit/log interactions.
- `src/gitManager.ts` — user-visible repository, status, Git, history, and
  recovery outcomes.
- `src/settings-sections/diagnostics.ts` — diagnostic controls and metrics.
- `src/settings-sections/maintenance.ts` — health, dry-run, repair, and restore
  controls.
- `src/ui/GitProgressModal.ts` — transfer and checkout progress presentation.
- `src/updater/PluginUpdater.ts` — update discovery, installation, and rollback.
- `memory-bank/assets/ui-mockups/` — approved sidebar visual references.
- Existing automated tests and recorded Memory Bank runtime evidence.
