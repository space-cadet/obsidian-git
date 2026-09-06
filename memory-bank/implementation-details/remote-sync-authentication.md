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

## Completion evidence

The user can authenticate, clone or connect a repository, pull changes, and
push a commit using a test remote.
