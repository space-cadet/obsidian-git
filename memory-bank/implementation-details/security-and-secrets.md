# Security and Secrets Boundary

*Created: 2026-08-11 02:03 IST*
*Last Updated: 2026-08-11 03:12 IST*
*Task: T35a, related to T34a*

## Purpose

Define how Git credentials and diagnostic data are handled so that a PAT or
password cannot be committed to the vault remote or exposed through logs.

## Current Risk

The first credential-safety change now stores only a per-vault secret ID in ordinary
plugin settings and excludes plugin-owned paths from automatic staging. The
actual credential is resolved through Obsidian `SecretStorage` immediately
before remote operations. Logger-managed output has a central redaction
boundary; direct UI error text and broader lifecycle coordination remain open.

## Required Boundary

1. Credentials are secrets, not ordinary display or diagnostic data.
2. Credential values must never appear in console logs, Notices, exported logs,
   error messages, tests, screenshots, or Memory Bank records.
3. The plugin's own settings and state files must never be staged as vault
   content by automatic sync.
4. Remote URLs must be normalized before logging or persistence; embedded URL
   credentials must be removed or rejected.
5. Diagnostics should return classifications and safe metadata, not raw server
   responses.

## Storage Decision

The plugin now requires Obsidian 1.11.4 or newer and uses `SecretStorage`.
Hosts without a usable store receive an explicit error and remote operations
are disabled; there is no plaintext fallback. `SecretStorage` is not claimed
to protect against trusted plugins running in the same Obsidian process.

## External Guidance and Chosen Direction — 2026-08-11

Obsidian's current plugin guidance recommends `SecretStorage` and
`SecretComponent`. The plugin settings should retain only a secret name or
reference; the actual PAT/password should be retrieved from
`app.secretStorage` when an operation needs it. This requires Obsidian 1.11.4
or newer and is the primary direction for this plugin.

References:

- Obsidian: [Store secrets](https://docs.obsidian.md/plugins/guides/secret-storage)
- Obsidian API: [`App.secretStorage`](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)
- Copilot: [Keychain migration and per-device storage](https://github.com/logancyang/obsidian-copilot/blob/master/RELEASES.md)
- Archivist: [SecretStorage use and same-instance plugin threat model](https://community.obsidian.md/plugins/archivist)

Related approaches were reviewed but are not the default for this plugin:

- Electron `safeStorage` or a native OS keychain can be useful for a
  desktop-only plugin, but platform availability and mobile behavior vary.
  Obfuscation fallbacks such as XOR/Base64 are not secure storage.
- Passphrase-based Web Crypto encryption can protect a local vault, but it
  requires a separate key-unlock lifecycle and is awkward for unattended Git
  sync. It should not be added merely to replace the built-in secret store.
- Git credential helpers (`osxkeychain`, Git Credential Manager, and
  `libsecret`) and SSH agents are appropriate for a native-Git transport. This
  plugin uses `isomorphic-git` and Obsidian `requestUrl`, so it cannot assume
  those helpers are available to the current transport. They remain relevant
  to the future SSH/native-transport decision.
- OAuth/device flow is preferable to manually copying long-lived PATs where a
  provider supports it. GitHub device flow remains owned by T34b.

`SecretStorage` reduces exposure through `data.json`, vault sync, backups, and
accidental Git staging, but it is not a plugin isolation boundary. A trusted
plugin running in the same Obsidian process may be able to request another
plugin's named secret. The README and acceptance tests must describe this
threat model without claiming protection from malicious in-process plugins or
malware running as the user.

## Implementation Plan

1. [x] Raise `manifest.json`'s minimum Obsidian version to the first supported
   version that provides `SecretStorage`, or add explicit feature detection
   before retaining the older minimum. Do not silently fall back to plaintext
   `data.json` storage.
2. [x] Replace the password/PAT setting with a `SecretStorage`-backed secret
   reference. Keep the Git username, remote URL, branch, author information,
   and provider metadata in ordinary settings because they are not secret
   values. Reject credentials embedded in remote URLs.
3. [x] Add one credential-resolution boundary that calls `getSecret()` just before
   Test Connection, clone, pull, push, fetch, and GitHub API fallback work.
   Pass resolved values only to the operation that needs them, and ensure
   settings changes cannot leave long-lived operations using stale credentials.
4. [x] Add a one-time migration for existing plaintext settings. Require a
   successful secret-store write before removing the legacy password field,
   report only success/failure classifications, and stop creating new
   credential-bearing backups. Handle old rolling backups through an explicit,
   documented cleanup step rather than silently deleting unrelated files.
5. Enforce the staging boundary independently of storage: automatic sync must
   exclude plugin settings, updater state, temporary files, and exported logs.
   This remains necessary because secret references, remote metadata, and
   future fallback state can still be sensitive even when the PAT is external.
6. Centralize redaction before logging, Notices, error propagation, and log
   export. Cover PATs, passwords, Basic Auth, URL user-info, authorization
   headers, and response/error bodies. Never add a plaintext fallback or call
   credential masking encryption.
7. Add desktop and mobile acceptance coverage: fresh setup, migration,
   missing secret, revoked/expired secret, secret replacement, new-device
   re-linking, Test Connection, clone/pull/push, log export, and staging-list
   inspection. Record the exact supported Obsidian versions and the verified
   at-rest behavior instead of inferring it from the API name.

## Redaction Rules

The logging boundary must redact at least:

- PAT and password values.
- `Authorization` headers and Basic Auth values.
- URLs containing user-info credentials.
- GitHub API response bodies when they may contain request or credential data.
- Error objects whose messages include request metadata.

Redaction should happen before data reaches the logger, not only during export.

## Staging Boundary

Automatic staging must apply an explicit exclusion policy for plugin-owned
settings and state. The policy should be tested against:

- `.obsidian/plugins/obsidian-git-sync/data.json`
- updater backup and temporary directories
- exported debug logs
- other plugin-owned runtime state

The user may still manually commit a file by deliberate action, but automatic
sync must not make credential exposure the default behavior.

## Current Source Audit and First Implementation Slice — 2026-08-11

- `src/main.ts:9-13, 231-236, 623-636` persists the password/PAT in ordinary
  plugin data and saves it directly from the settings control.
- `src/logger.ts` now applies `redactSensitiveText` and `redactSensitiveData`
  before retention, console output, Notices, and export.
- `src/gitManager.ts` registers the current password with the logger, rejects
  embedded URL credentials, and excludes plugin-owned paths from automatic
  staging.
- Direct UI error Notices and ordinary password settings remain open; the
  SecretStorage migration is not included in this first slice.
- `src/main.ts:326-360, 452-461` can leave direct pull/push operations using
  credentials captured before a settings change.

The current verification passes 19 Node tests and 10 isomorphic-git checks.
New tests cover redaction, URL normalization, repository classification, and
staged-file exclusions; settings persistence, export-file inspection, and
credential freshness remain open.

## Related Tasks

- T34/T34a: Remote authentication and safe diagnostics
- T35: Plugin Reliability, Security, Lifecycle, Transport, Updater, and Test Follow-up
- T35f: Test, CI, and Documentation Alignment
