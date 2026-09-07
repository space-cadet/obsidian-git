# T7: Remote Sync and Authentication

*Last Updated: 2026-09-07 05:29:49 IST*

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
- Settings hold the remote URL, branch, and SecretStorage-backed credential
  configuration; Git operations are kept in the Changes action bar.
- The Changes action bar exposes Fetch through the refresh action, plus Pull and
  Push next to the local file actions.
- Fetch, Pull, and Push attach or refresh the configured `origin` remote before
  running; Clone requires an empty vault-relative destination.
- Remote operations are queued so two Git mutations cannot run concurrently,
  and each result is recorded in Activity with a notice.
- Remote operations now show immediate in-progress feedback before the network
  request completes, so a slow or rejected operation is not visually silent.
- Remote setup, transfer, and finalization phases are reported to the progress
  modal and Activity. Push completes after the server result without the old
  working-tree/history summary scan.
- Settings clicks, operation start, transport milestones, and completion or
  failure are all written to the live Activity view. Errors include Git error
  codes and callers when the transport provides them.
- Pull supplies the configured commit identity to the Git library, avoiding a
  dependency on `.git/config` user fields.
- The Obsidian HTTP bridge normalizes array, async-iterator, and iterator Git
  request bodies and exposes response bodies as async iterables.
- Pull and Clone refresh repository metadata and explicitly mark Changes as
  needing refresh instead of blocking completion on a full vault scan.

## Completion evidence

The source implementation supports authentication, clone or connect, pull,
fetch, and push through the configured HTTP(S) remote. Production build and
static diff checks pass. The user verified the pushed remote workflow, including
Pull and Push from the Changes toolbar. Progress modals and Git-style result
messages are implemented; additional edge-case acceptance remains planned.
