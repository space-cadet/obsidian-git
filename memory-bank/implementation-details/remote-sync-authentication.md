# T7: Remote Sync and Authentication

## Purpose

Connect the local repository to a configured remote for the common sync flows.

## Initial scope

- Remote transport
- One supported credential path
- Fetch and pull
- Push and clone
- Clear operation results

## KISS boundary

Implement one direct path first. Do not add multiple credential providers,
device flow, retry policy, or recovery automation until a real requirement is
recorded.

## Current implementation

- Remote URLs are restricted to HTTP or HTTPS and tested through Obsidian's
  request bridge.
- Remote username and token/password settings are available.
- Tokens use Obsidian SecretStorage and are exposed to operations only as a
  username/token credential pair.
- A connection test records success or failure in the Log and reports the
  remote default branch when available.
- Settings now expose Fetch, fast-forward-only Pull, Push, and Clone actions.
- Fetch, Pull, and Push attach or refresh the configured `origin` remote before
  running; Clone requires an empty vault-relative destination.
- Remote operations are queued so two Git mutations cannot run concurrently,
  and each result is recorded in Activity with a notice.

## Completion evidence

The source implementation supports authentication, clone or connect, pull,
fetch, and push through the configured HTTP(S) remote. Production build and
static diff checks pass. A real test-remote run and installed-host acceptance
are still required before this task is complete.
