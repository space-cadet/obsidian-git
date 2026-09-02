# Full Sidebar UI Redesign

*Created: 2026-09-02 14:11:31 IST*
*Last Updated: 2026-09-03 02:37:37 IST*
*Task: T29a*

## Design Decision

The three approved sidebar mockups are the visual specification for a full
presentation redesign. The existing contextual interaction model remains the
behavioral contract, but the sidebar markup and CSS may be replaced as one
coherent UI pass.

The goal is to preserve the current feature set while improving hierarchy,
spacing, typography, icon consistency, surface treatment, and responsive
behavior. This is not a redesign of GitManager or the plugin's repository
state behavior.

## Implementation Status

- The mockup-matching source-level presentation pass is implemented in
  `src/views/GitSidebarView.ts` and `styles.css`. It replaces the previous
  flat file rows, header status treatment, commit list, and log layout.
- Existing Git handlers remain in place; the pass adds shared shell semantics,
  icon treatment, checkbox/status/path columns, commit timeline cards,
  accessible controls, and coordinated responsive styling.
- Production build, archive, the full test command, and `git diff --check`
  pass.
- Real Obsidian desktop/mobile screenshot acceptance is still pending.

## Reference Assets

- memory-bank/assets/ui-mockups/sidebar-changes-approved.png
- memory-bank/assets/ui-mockups/sidebar-commits-approved.png
- memory-bank/assets/ui-mockups/sidebar-log-approved.png

The attached current-UI photographs are review evidence for the visual gap.
They are not copied into the repository by this planning record.

## Current-to-Target Findings

- Tabs currently use a lighter implementation of the target structure but do
  not yet provide the mockup's complete visual hierarchy and icon language.
- The branch header currently uses a text dot, compact branch text, and a
  separate status line; the target uses a stronger branch/status grouping.
- Changes section headers give bulk actions prominent button treatment; the
  target gives file lists, counts, and section structure more visual priority.
- File rows, action buttons, and status markers use mixed glyph and theme
  treatments that should become one consistent system.
- Commits currently expose the required Local/Remote and expansion behavior but
  need the mockup's calmer timeline/card spacing and metadata hierarchy.
- Log currently has the required toolbar and activity rows but needs the
  mockup's compact activity-feed rhythm and utility treatment.
- The bottom Git Sync element visible in the supplied photographs appears to
  be surrounding Obsidian view chrome and must be assessed separately.

## Proposed Presentation Structure

### Shared Shell

- Full-height sidebar container.
- Three equal tabs with a clear active indicator.
- Repository header containing branch icon, branch name, status, refresh, and
  settings.
- Content panel as the single vertical scroll owner.
- Changes-only fixed action bar with bottom padding.

### Changes

- Staged and Uncommitted Changes sections with count badges and disclosure
  controls.
- Compact file rows with status marker, readable path, primary stage/unstage
  control, and secondary menu.
- Preserve Stage all, Unstage all, .gitignore, force push, commit modal, Pull,
  Push, and More actions.

### Commits

- Mockup-style Local/Remote segmented control.
- Calm commit timeline/list with message, hash, author, date, disclosure
  affordance, and expanded file details.
- Preserve local history, remote history, GitHub fallback, loading, empty, and
  failure states.

### Log

- Activity heading and compact More control.
- Readable timestamp, level, namespace, message, and detail rows.
- Preserve Export log, Clear log, and Copy details.

## Visual Rules

- Prefer Obsidian theme variables so light and dark themes remain supported.
- Use one spacing scale and one control-radius scale across all three tabs.
- Use semantic Obsidian icons or one consistent inline icon set instead of
  mixing unrelated text glyphs.
- Keep primary actions visually clear and secondary actions quiet.
- Preserve accessible labels, disabled states, focus states, and row hit areas.
- Do not hide the scrollbar or create multiple competing vertical scroll owners.
- Do not let the fixed action bar cover the last content row.

## Behavior Preservation Map

| Existing behavior | Redesigned presentation |
| --- | --- |
| Stage/unstage a file | Primary file-row control |
| Stage all/Unstage all | Section action or contextual section control |
| Ignore and .gitignore editing | File menu and Changes More menu |
| Commit staged files | Changes fixed action bar and commit modal |
| Pull, Push, Force Push | Changes action bar and More menu |
| Local/Remote commits | Commits segmented control |
| Expand commit files | Full commit-row disclosure |
| Log utilities | Log More menu |
| Refresh and settings | Shared repository header |

## Acceptance Evidence

- Source verification: production build, automated tests, and git diff check.
- Visual verification: screenshots at mobile, desktop, and intermediate widths.
- Runtime verification: real Obsidian desktop/mobile open, resize, scroll,
  action, loading, error, and empty-state checks.
- Release verification: redesign acceptance remains part of T29 and does not
  by itself authorize a public release.

## Not in Scope

- Git protocol or repository-state behavior.
- Authentication diagnostics or device-flow sign-in.
- Updater integrity and release-asset signing.
- Progress transport changes.
- Removal of Obsidian-owned surrounding view chrome.

## Follow-up Audit — 2026-09-02

- The branch/header and Local/Remote selector should support compact density
  settings while preserving usable touch targets. The current source has no
  separate branch-selection control; branch switching remains T31 scope.
- The visual implementation should consume a shared sidebar read snapshot and
  load only the active tab's data. Repeated status scans and stale asynchronous
  renders are performance and lifecycle follow-ups, not new visual variants.
- Remote commit browsing and damaged-repository rebuilding are documented under
  T30 and T35c because they change repository-state behavior rather than the
  mockup presentation contract.

## Session Update — 2026-09-03

- Compact is now the only sidebar density; the temporary comfortable setting
  was removed after the user's layout feedback.
- The `.gitignore` editor received visual-viewport sizing and focus scrolling,
  but Android testing still shows keyboard overlap. Real WebView inspection is
  required before this behavior can be accepted.
