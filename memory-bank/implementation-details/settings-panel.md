# T2: Settings Panel

## Purpose

Give the user a simple place to configure the repository used by the plugin.

## Initial scope

- Repository location or vault association
- Remote URL
- Branch name
- Auto-save and basic validation
- Secure remote credential entry with visibility control
- Updater channel, startup-check, auto-install, and build-browser controls
- Sidebar Open Settings action

## KISS boundary

Keep migration limited to the versioned plugin-data envelope. Do not add
provider registries, multiple profiles, or advanced credential flows until the
basic configuration workflow requires them.

## Current implementation

- Text settings schedule a debounced save; unload also flushes the current data.
- Remote tokens are stored in Obsidian SecretStorage rather than plugin data.
- The token field is masked by default and becomes editable when revealed.
- Deleting the revealed value clears the stored token.
- Plugin data is stored in a versioned envelope with `format`,
  `schemaVersion`, `settings`, and bounded `activity` fields.
- Existing flat plugin data is accepted and migrated to the versioned envelope
  on load; unknown settings are ignored during normalization.
- Settings can export and import JSON backups. Export writes a timestamped file
  to the vault root and records the path in Activity; the remote token is
  excluded, imports require confirmation, and the current SecretStorage
  credential is preserved.
- Activity inclusion in exports is controlled by a Settings toggle and is off
  by default; export metadata records whether activity was included.

## Completion evidence

Settings are registered and the sidebar opens the plugin tab directly. The
repository, remote, branch, updater, auto-save, validation, and credential
visibility controls are implemented. The user verified the pushed build.
