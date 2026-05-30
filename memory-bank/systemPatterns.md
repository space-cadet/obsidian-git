# System Patterns

*Created: 2026-05-30 17:40:00 IST*
*Last Updated: 2026-05-30 17:40:00 IST*

## Adapter Pattern

### Vault FS Adapter
The core challenge is translating Obsidian's Vault API to isomorphic-git's expected Node.js `fs` interface.

```
Obsidian Vault API  →  VaultFsAdapter  →  isomorphic-git fs interface
- vault.read()         - readFile()        - readFile(path, cb)
- vault.create()       - writeFile()       - writeFile(path, data, cb)
- vault.modify()       - writeFile()       - writeFile(path, data, cb)
- vault.adapter.list() - readdir()         - readdir(path, cb)
- vault.adapter.mkdir() - mkdir()           - mkdir(path, cb)
- vault.adapter.exists() - stat()          - stat(path, cb)
```

**Key decisions:**
- Use Vault API as primary (works everywhere)
- Fallback to LightningFS for edge cases (binary files, large repos)
- All operations async (Vault API is promise-based)

### Auth Strategy Pattern

```
GitManager
├── DesktopAuthProvider (SSH + HTTPS)
│   ├── SSHAgentAuth
│   └── TokenAuth
└── MobileAuthProvider (HTTPS only)
    ├── SecureTokenStorage (Keychain/Keystore)
    └── TokenAuth
```

Platform detection: Check `Platform.isMobile` from Obsidian API.

### Git Operation Wrapper Pattern

All git operations wrapped for:
1. **Error handling** — Convert isomorphic-git errors to user-friendly messages
2. **Progress reporting** — Emit events for UI status bar
3. **Cancellation** — Support aborting long-running operations
4. **Logging** — Consistent debug logging across all operations

### Settings Migration Pattern

When switching from simple-git to isomorphic-git:
- Existing settings preserved (repo path, remote URL, user info)
- Auth settings need migration (SSH → token for mobile)
- Show migration notice to user on first run

## State Management

### GitManager State
- `idle` — No active operation
- `cloning` — Clone in progress
- `syncing` — Pull/push in progress
- `committing` — Commit in progress
- `error` — Last operation failed

### UI State (GitSyncView)
- `loading` — Fetching git status
- `ready` — Status displayed
- `empty` — No repo configured
- `error` — Failed to read status

## Error Handling Strategy

1. **Categorize errors**:
   - Network errors (offline, timeout, CORS)
   - Auth errors (bad token, expired, no permission)
   - Git errors (merge conflict, dirty working tree)
   - File system errors (permission denied, disk full)

2. **User-friendly messages**:
   - Show actionable error ("Your token expired. Update in settings.")
   - Log full technical details for debugging

3. **Recovery**:
   - Retry network errors (with exponential backoff)
   - Prompt for re-auth on token errors
   - Manual conflict resolution for merge errors

## Mobile-Specific Patterns

### Background Sync
- Use Obsidian's `onLayoutReady` for initial sync
- Register interval with `window.setInterval` (limited on mobile)
- Use `requestIdleCallback` or similar for non-urgent operations
- Show notification when sync completes (if enabled)

### Battery & Performance
- Defer heavy operations (full clone, large pulls) until on charger
- Use `navigator.connection.effectiveType` to check network quality
- Skip auto-sync on cellular data (configurable)

### Secure Storage
- Desktop: Obsidian settings (already encrypted by OS)
- Mobile: Implement minimal secure storage wrapper
  - iOS: Use Keychain via Capacitor plugin or Obsidian's native bridge
  - Android: Use EncryptedSharedPreferences via Capacitor
  - Fallback: Store in Obsidian settings (less secure but functional)

*Last Updated: 2026-05-30 17:40:00 IST*
