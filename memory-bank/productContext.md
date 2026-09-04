# Product Context

*Last Updated: 2026-09-04 11:36:55 IST*

Obsidian Git Sync is an Obsidian plugin for tracking a vault with Git on
desktop and mobile. Its current product surface includes the Git sidebar,
Git Sync Settings, manual and automatic synchronization, repository history,
`.gitignore` controls, diagnostics, maintenance, and plugin updates.

The complete current product contract is recorded in
[`product-spec.md`](product-spec.md). That specification is implementation-
agnostic and is the source from which the rewrite PRD will be prepared.

The first rewrite PRD draft is recorded in
[`product-prd.md`](product-prd.md). It remains subject to user review before
the rewrite task and branch are created.

The rewrite direction is UI-preserving: retain the existing Settings panel,
sidebar layout, styles, dialogs, and proven updater experience, while replacing
the Git/repository mechanics and the path by which their results update the
UI.

The approved sidebar visual references remain in
[`assets/ui-mockups/`](assets/ui-mockups/). The current product specification
records the existing UI and evidenced behaviour; it does not record the
current code's internal ownership or call structure.
