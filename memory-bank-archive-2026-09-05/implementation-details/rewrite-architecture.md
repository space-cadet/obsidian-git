# KISS Rewrite Architecture

## Current architecture finding

The current `GitManager` is a 2,900-line mixed boundary. It owns Git
operations, isomorphic-git HTTP transport, credentials, progress, Notices,
status-bar updates, logging, repository health, index repair, rebuild preview,
history fallback, cancellation, and staging policy. `main.ts` owns another
part of the operation lifecycle and constructs the manager, while
`GitSidebarView` calls manager methods directly and performs its own refresh,
cache, and repaint decisions.

This creates a long path for simple actions such as staging one file and
showing repository status. The rewrite therefore starts with a separate
backend rather than extending the existing manager.

## Rewrite boundary

```text
Obsidian adapter / native HTTP / SecretStorage
                    |
                    v
          platform-neutral backend
                    |
                    v
       plain state and operation results
                    |
                    v
       retained Settings and sidebar UI
```

The backend does not import Obsidian and does not render, notify, log to a UI,
choose tabs, or repaint. Platform-specific concerns are supplied as ports:
filesystem, HTTP transport, and credential provider.

## KISS rules

- A local status read performs one working-tree status operation and returns
  the complete local result.
- Remote comparison is explicit, because it may require history traversal or
  network work and must not delay the first useful local status.
- Stage and unstage operate on the requested path directly. They do not run a
  full status read first.
- Bulk operations return successful and failed paths directly.
- The UI performs one visible update from the completed result.
- No new event bus, general cache, or generic coordinator is part of the
  backend design.

## Authentication

PAT credentials and GitHub device-flow credentials both become the same
backend `GitCredential` shape. The backend never persists credentials. The
host integration supplies and stores them through its secure credential port.

GitHub device flow is implemented without a callback server. The live gate
validates the authenticated GitHub account, repository access, and a
read-only Git smart-HTTP clone before the backend is connected to the UI. The
current live run uses the already-authenticated external `gh` OAuth session;
the interactive device flow still requires the plugin's registered OAuth App
client ID and remains a separate acceptance step.

## Implemented Branch Record — 2026-09-05

The `rewrite/git-backend-kiss` branch implemented this boundary under
`src/backend/` and connected it to the retained Obsidian Settings, sidebar,
progress, diagnostics, maintenance, and updater surfaces. The detailed result
and verification are recorded in
`implementation-details/T39-kiss-branch-summary.md`.

The branch deliberately did not introduce a global event bus, generic cache, or
multi-layer operation framework. The remaining device, live-remote, and real
Obsidian acceptance items remain open.
