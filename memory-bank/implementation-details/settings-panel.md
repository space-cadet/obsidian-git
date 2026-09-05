# T2: Settings Panel

## Purpose

Give the user a simple place to configure the repository used by the plugin.

## Initial scope

- Repository location or vault association
- Remote URL
- Branch name
- Save and basic validation
- Clear settings feedback
- Updater channel, startup-check, auto-install, and build-browser controls
- Sidebar Open Settings action

## KISS boundary

Do not add migrations, provider registries, multiple profiles, or advanced
credential flows until the basic configuration workflow requires them.

## Completion evidence

Settings are registered and the sidebar opens the plugin tab directly. The
repository, remote, branch, updater, save, and validation controls are
implemented. Published-build reopen/save verification remains open.
