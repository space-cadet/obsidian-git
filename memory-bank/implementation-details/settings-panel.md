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

Do not add migrations, provider registries, multiple profiles, or advanced
credential flows until the basic configuration workflow requires them.

## Current implementation

- Text settings schedule a debounced save; unload also flushes the current data.
- Remote tokens are stored in Obsidian SecretStorage rather than plugin data.
- The token field is masked by default and becomes editable when revealed.
- Deleting the revealed value clears the stored token.

## Completion evidence

Settings are registered and the sidebar opens the plugin tab directly. The
repository, remote, branch, updater, auto-save, validation, and credential
visibility controls are implemented. The user verified the pushed build.
