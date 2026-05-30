# Technical Context

*Created: 2026-05-30 17:40:00 IST*
*Last Updated: 2026-05-30 17:40:00 IST*

## Technology Stack

### Current (Desktop-Only)
- **Runtime**: Node.js (via Obsidian desktop Electron shell)
- **Git Library**: `simple-git` — Node.js wrapper around system `git` CLI binary
- **Filesystem**: Node.js `fs`/`path` modules
- **Auth**: SSH keys via system agent, or HTTPS with token stored in settings
- **Build**: ESBuild bundling TypeScript → single JS file

### Target (Desktop + Mobile)
- **Runtime**: Any JavaScript environment (Electron, WebView, browser)
- **Git Library**: `isomorphic-git` — Pure JavaScript reimplementation of Git
- **Filesystem**: Obsidian `Vault` API (`read`, `create`, `modify`, `adapter`)
- **Auth**: Token-based (GitHub/GitLab personal access tokens) — no SSH on mobile
- **Build**: ESBuild (unchanged) — isomorphic-git is ~500KB gzipped

## Key Differences

| Aspect | simple-git | isomorphic-git |
|--------|-----------|----------------|
| Binary dependency | Requires `git` CLI | None (pure JS) |
| Environment | Node.js only | Any JS environment |
| Performance | Native binary, fast | Interpreted, slower |
| Bundle size | Small (just wrapper) | ~500KB gzipped |
| Advanced features | Full git CLI power | Core subset (clone, add, commit, push, pull, log, status) |
| Auth | SSH + HTTPS | HTTPS only (token-based) |
| FS access | Direct Node fs | Abstracted (LightningFS, Vault API, etc.) |

## Mobile-Specific Constraints

### iOS
- No shell access
- No Node.js modules
- WebView JavaScript environment
- Keychain for secure token storage
- Background sync limited (max ~30s processing time)

### Android
- No shell access in Obsidian
- WebView JavaScript environment
- SharedPreferences/Keystore for tokens
- More background freedom than iOS but still limited

### Both
- No SSH agent → must use HTTPS + tokens
- No filesystem access outside vault → use Obsidian Vault API
- Network requests may need CORS handling
- Limited compute → avoid large git operations on main thread

## Isomorphic-Git Architecture

### Core Operations (supported)
- `git.clone` — Clone repository
- `git.add` — Stage files
- `git.remove` — Unstage/remove files
- `git.commit` — Create commit
- `git.push` — Push to remote
- `git.pull` — Pull from remote (fast-forward only by default)
- `git.fetch` — Fetch from remote
- `git.log` — Read commit history
- `git.status` — Check working directory status
- `git.branch` — List/create branches
- `git.checkout` — Switch branches
- `git.merge` — Merge branches (fast-forward)

### Notable Limitations
- **No SSH** — Only HTTPS with token auth
- **No `git add -p`** — All-or-nothing staging per file
- **No hooks** — Pre-commit hooks not supported
- **No submodules** — Not implemented
- **No signed commits** — GPG signing not available
- **Conflict resolution** — Basic, may need manual intervention

### Required Abstractions
1. **fs backend** — Maps isomorphic-git's `fs` interface to Obsidian Vault API
2. **HTTP backend** — Handles git HTTP(S) protocol, may need proxy for CORS
3. **Token storage** — Secure storage for auth tokens (mobile keychain/keystore)

## Obsidian Vault API Mapping

Obsidian provides these filesystem-like operations:
- `vault.read(path)` → Read file contents (returns string)
- `vault.create(path, data)` → Create new file
- `vault.modify(file, data)` → Modify existing file (takes TFile object)
- `vault.adapter.readBinary(path)` → Read binary data
- `vault.adapter.writeBinary(path, data)` → Write binary data
- `vault.adapter.exists(path)` → Check if path exists
- `vault.adapter.mkdir(path)` → Create directory
- `vault.adapter.rmdir(path)` → Remove directory
- `vault.adapter.list(path)` → List directory contents

We need to create an adapter that translates these to isomorphic-git's `fs` interface (which expects Node.js-like `fs` methods).

## Performance Considerations

- isomorphic-git is significantly slower than native git for large repos
- For typical Obsidian vaults (<10MB, <1000 files), this is acceptable
- Large binary files (images, PDFs) should be tracked with Git LFS or excluded
- Consider async/await and Obsidian's `requestUrl` for network operations

## Dependencies to Add/Remove

### Remove
- `simple-git` (and its transitive dependencies)

### Add
- `isomorphic-git` — Core git operations
- `@isomorphic-git/lightning-fs` — IndexedDB-backed filesystem (fallback if Vault API insufficient)
- `buffer` (polyfill) — isomorphic-git uses Node.js Buffer

## Token-Based Auth Strategy

1. **Desktop**: Continue supporting SSH (via proxy) + HTTPS tokens
2. **Mobile**: HTTPS tokens only
3. **Token storage**: 
   - Desktop: Obsidian settings (encrypted at rest by OS)
   - Mobile: Platform secure storage (Keychain/Keystore) via Capacitor plugin or Obsidian API
4. **GitHub**: Personal Access Token (classic or fine-grained)
5. **GitLab**: Personal Access Token
6. **Other providers**: Generic HTTPS username/password or token

## Branch Strategy for Implementation

1. `simple-git` — Current, stable, desktop-only (keep for reference)
2. `isomorphic-git` — New implementation target
3. Future: Merge to `main` after mobile validation

## Testing Strategy

- **Unit tests**: Mock Vault API, test fs adapter, test auth flows
- **Integration tests**: Test against real git repos (local bare repos)
- **E2E tests**: Full clone→edit→commit→push workflow (use test repos)
- **Mobile tests**: Manual testing on iOS/Android (no automated mobile testing available)

*Last Updated: 2026-05-30 17:40:00 IST*
