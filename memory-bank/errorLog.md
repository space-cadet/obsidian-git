# Error Log

*Created: 2026-05-30 16:05:00 IST*
*Last Updated: 2026-05-30 16:05:00 IST*

## Known Issues

### E1: simple-git fails on mobile
**Status**: 🔴 Active
**First Seen**: Project inception (2025-03-17)
**Description**: The current `simple-git` dependency requires the `git` CLI binary which does not exist on iOS/Android. This makes the plugin completely non-functional on mobile.
**Impact**: Critical — entire plugin useless on mobile
**Workaround**: None. Must port to isomorphic-git.
**Resolution**: T1 — Port to isomorphic-git

### E2: Node fs/path modules on mobile
**Status**: 🔴 Active
**First Seen**: Project inception (2025-03-17)
**Description**: `gitManager.ts` imports Node.js `fs` and `path` modules directly. These are unavailable in Obsidian mobile's JavaScript environment.
**Impact**: Critical — plugin crashes on load
**Workaround**: None. Must use Obsidian Vault API.
**Resolution**: T1 — Replace with Obsidian Vault API

### E3: Mobile authentication
**Status**: 🟡 Pending
**First Seen**: 2025-04-17
**Description**: The `mobile-adapter.ts` file contains only stubs for iOS keychain and Android storage. No real mobile auth implementation exists.
**Impact**: High — cannot authenticate with GitHub on mobile
**Workaround**: None yet
**Resolution**: T1 — Implement real mobile auth

## Resolved Issues

### E0: Initial desktop scaffold
**Status**: ✅ Resolved
**Resolution**: Basic desktop plugin working with simple-git
