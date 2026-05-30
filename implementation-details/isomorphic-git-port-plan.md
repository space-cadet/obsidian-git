# Implementation Plan: Port to isomorphic-git

*Created: 2026-05-30 17:45:00 IST*
*Last Updated: 2026-05-30 17:45:00 IST*
*Status: DESIGN PHASE*

## Overview

This document details the phased implementation plan for replacing `simple-git` with `isomorphic-git` to enable mobile support in the obsidian-git plugin.

## Phase 1: Foundation & Research (Completed)

### 1.1 Code Analysis ✅
- **Completed**: Read and analyzed `gitManager.ts`, `main.ts`, `settings.ts`, `mobile-adapter.ts`
- **Finding**: `gitManager.ts` ~200 lines, uses `simpleGit()` factory, Node `fs`/`path`
- **Finding**: All git operations centralized in `GitManager` class — clean separation

### 1.2 Dependency Analysis ✅
- **simple-git**: Currently listed in `dependencies`
- **Node fs/path**: Used directly in `gitManager.ts`
- **Winston logger**: Used in `gitManager.ts` for logging — keep, works everywhere

### 1.3 Memory Bank Setup ✅
- Memory bank initialized following mb-core v6.12 protocol
- Task T1 created with completion criteria
- Technical context and system patterns documented

## Phase 2: Branch Setup & Dependency Swap (Next)

### 2.1 Create isomorphic-git Branch
```bash
git checkout -b isomorphic-git
```

### 2.2 Package.json Updates
**Remove:**
```json
"simple-git": "^3.22.0"
```

**Add:**
```json
"isomorphic-git": "^1.0.0",
"buffer": "^6.0.3"
```

**Dev dependency (for types):**
```json
"@types/isomorphic-git": "^1.0.0" // if available, or use module declarations
```

### 2.3 ESBuild Configuration Check
- Verify isomorphic-git bundles correctly with ESBuild
- Check if any Node.js polyfills needed (`buffer`, `path`, `fs`)
- Add `define` or `inject` if needed for browser compatibility

### 2.4 Install Dependencies
```bash
pnpm install
# or
npm install
```

**Deliverable**: Build passes with new dependencies, branch ready for development.

## Phase 3: Vault FS Adapter (Critical)

### 3.1 Design FS Interface
isomorphic-git expects a Node.js `fs`-like object with these methods:
- `readFile(path, options, callback)` → returns Buffer/string
- `writeFile(path, data, options, callback)`
- `mkdir(path, options, callback)`
- `rmdir(path, callback)`
- `readdir(path, options, callback)` → returns string[]
- `stat(path, callback)` → returns Stats object
- `lstat(path, callback)`
- `unlink(path, callback)`

### 3.2 Implement VaultFsAdapter

**New file: `src/adapters/VaultFsAdapter.ts`**

```typescript
import { Vault, TFile, normalizePath } from 'obsidian';

export class VaultFsAdapter {
  constructor(private vault: Vault) {}

  async readFile(path: string, options?: any): Promise<Buffer | string> {
    const normalized = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      const content = await this.vault.read(file);
      return options?.encoding === 'utf8' ? content : Buffer.from(content);
    }
    throw new Error(`ENOENT: ${path}`);
  }

  async writeFile(path: string, data: string | Buffer, options?: any): Promise<void> {
    const normalized = normalizePath(path);
    const existing = this.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      await this.vault.modify(existing, data.toString());
    } else {
      await this.vault.create(normalized, data.toString());
    }
  }

  // ... implement all required methods
}
```

**Challenges:**
- Obsidian Vault API is promise-based, fs expects callbacks → wrap with `new Promise()`
- Binary files: `vault.adapter.readBinary()` / `writeBinary()` for `.git/objects/`
- Directory operations: `vault.adapter.mkdir()` / `rmdir()` / `list()`

### 3.3 Binary File Handling
Git stores objects as binary blobs in `.git/objects/`. Obsidian's Vault API is primarily text-oriented.

**Solution:**
- Use `vault.adapter.readBinary()` and `vault.adapter.writeBinary()` for `.git/` internals
- These methods work with `ArrayBuffer` — convert to/from Node.js Buffer

### 3.4 Unit Tests for Adapter
Create tests that verify:
- Read/write roundtrip
- Directory creation/listing
- Error handling (ENOENT simulation)
- Binary data preservation

**Deliverable**: `VaultFsAdapter.ts` with full test coverage, build passes.

## Phase 4: GitManager Rewrite

### 4.1 Interface Design
Keep the same public API to minimize changes in `main.ts` and UI components:

```typescript
export class GitManager {
  // Same methods as before:
  async initialize(): Promise<void>;
  async sync(): Promise<void>;
  async commitAndPush(message: string): Promise<void>;
  async getStatus(): Promise<GitStatus>;
  async getLog(n?: number): Promise<CommitInfo[]>;
  async getChangedFiles(): Promise<string[]>;
  
  // Internal:
  private async addAndCommit(message: string): Promise<void>;
  private async push(): Promise<void>;
  private async pull(): Promise<void>;
}
```

### 4.2 Implementation Steps

**Step 4.2.1: Constructor & Initialization**
```typescript
import * as git from 'isomorphic-git';
import { VaultFsAdapter } from './adapters/VaultFsAdapter';

export class GitManager {
  private fs: VaultFsAdapter;
  private dir: string;
  
  constructor(private vault: Vault, private settings: GitSettings) {
    this.fs = new VaultFsAdapter(vault);
    this.dir = settings.repoPath || '.';
  }
  
  async initialize() {
    // Check if .git exists
    // If not, clone or init
  }
}
```

**Step 4.2.2: Clone Operation**
```typescript
async clone(): Promise<void> {
  await git.clone({
    fs: this.fs,
    http: this.getHttpClient(),
    dir: this.dir,
    url: this.settings.remoteUrl,
    singleBranch: true,
    depth: 1, // shallow clone for performance
    onAuth: () => ({ username: 'token', password: this.settings.token }),
  });
}
```

**Step 4.2.3: Status & Changed Files**
```typescript
async getStatus(): Promise<GitStatus> {
  const statusMatrix = await git.statusMatrix({
    fs: this.fs,
    dir: this.dir,
  });
  
  // statusMatrix returns [[filepath, headStatus, workdirStatus, stageStatus]]
  // Map to our GitStatus interface
}

async getChangedFiles(): Promise<string[]> {
  const status = await this.getStatus();
  return status.changed;
}
```

**Step 4.2.4: Commit & Push**
```typescript
async commitAndPush(message: string): Promise<void> {
  // Stage all changes
  await git.add({ fs: this.fs, dir: this.dir, filepath: '.' });
  
  // Commit
  await git.commit({
    fs: this.fs,
    dir: this.dir,
    message,
    author: {
      name: this.settings.userName,
      email: this.settings.userEmail,
    },
  });
  
  // Push
  await git.push({
    fs: this.fs,
    http: this.getHttpClient(),
    dir: this.dir,
    remote: 'origin',
    ref: this.settings.branch || 'main',
    onAuth: () => ({ username: 'token', password: this.settings.token }),
  });
}
```

**Step 4.2.5: Pull / Sync**
```typescript
async sync(): Promise<void> {
  // Fetch first
  await git.fetch({
    fs: this.fs,
    http: this.getHttpClient(),
    dir: this.dir,
    remote: 'origin',
    onAuth: () => ({ username: 'token', password: this.settings.token }),
  });
  
  // Check if fast-forward possible
  // If yes, pull. If no, handle conflict
  await git.pull({
    fs: this.fs,
    http: this.getHttpClient(),
    dir: this.dir,
    remote: 'origin',
    ref: this.settings.branch || 'main',
    onAuth: () => ({ username: 'token', password: this.settings.token }),
    fastForwardOnly: true, // safe default
  });
}
```

**Step 4.2.6: Log**
```typescript
async getLog(n: number = 10): Promise<CommitInfo[]> {
  const commits = await git.log({
    fs: this.fs,
    dir: this.dir,
    depth: n,
  });
  
  return commits.map(commit => ({
    hash: commit.oid,
    message: commit.commit.message,
    date: commit.commit.committer.timestamp,
    author: commit.commit.author.name,
  }));
}
```

### 4.3 Error Handling
Wrap isomorphic-git errors with user-friendly messages:

```typescript
private handleGitError(error: any, operation: string): void {
  if (error.code === 'NotFoundError') {
    throw new Error(`Repository not found. Check your remote URL in settings.`);
  }
  if (error.code === 'HttpError' && error.statusCode === 401) {
    throw new Error(`Authentication failed. Update your token in settings.`);
  }
  if (error.code === 'MergeNotSupportedError') {
    throw new Error(`Merge conflict detected. Please resolve manually.`);
  }
  // ... etc
  throw error;
}
```

**Deliverable**: Complete `gitManager.ts` rewrite, all original methods preserved.

## Phase 5: HTTP Client & Auth

### 5.1 HTTP Client for isomorphic-git
isomorphic-git needs an HTTP client. On desktop, we can use `fetch`. On mobile, we may need `requestUrl` from Obsidian API (handles CORS).

```typescript
import { requestUrl } from 'obsidian';

function createHttpClient() {
  return {
    async request({ url, method, headers, body }: any) {
      // Use Obsidian's requestUrl for mobile compatibility
      const response = await requestUrl({
        url,
        method,
        headers,
        body,
      });
      return {
        url: response.url,
        method,
        headers: response.headers,
        body: response.arrayBuffer ? await response.arrayBuffer() : response.text,
        statusCode: response.status,
        statusMessage: response.statusText,
      };
    }
  };
}
```

### 5.2 Auth Flow

**Desktop:**
- SSH: Keep existing proxy server approach (if feasible)
- HTTPS Token: Store in Obsidian settings

**Mobile:**
- HTTPS Token only
- Store in:
  - iOS: Keychain (via minimal native bridge if available, or Obsidian settings)
  - Android: EncryptedSharedPreferences (similar)
  - Fallback: Obsidian settings (warn user it's less secure)

### 5.3 Settings UI Update
Update `settings.ts` to:
- Show token-based auth prominently
- Hide SSH options on mobile (`Platform.isMobile`)
- Add token generation instructions link
- Test connection button (validates token works)

**Deliverable**: Auth works on desktop and mobile, settings UI updated.

## Phase 6: Integration & Testing

### 6.1 main.ts Integration
Minimal changes expected since `GitManager` API is preserved:

```typescript
// In main.ts, constructor:
this.gitManager = new GitManager(this.app.vault, this.settings);
```

Checklist:
- [ ] Ribbon icon triggers sync
- [ ] Status bar shows sync state
- [ ] Settings panel loads
- [ ] Sidebar view (GitSyncView) displays log/status

### 6.2 Build Verification
```bash
pnpm run build
# Verify:
# - No TypeScript errors
# - No bundle errors
# - Output size reasonable (< 1MB including isomorphic-git)
```

### 6.3 Manual Testing Checklist

**Desktop (macOS):**
- [ ] Clone new repo
- [ ] Pull changes
- [ ] Edit file → auto-detect → commit → push
- [ ] View git log
- [ ] View changed files
- [ ] Handle conflict scenario

**Mobile (iOS - simulator or device):**
- [ ] Clone new repo
- [ ] Pull changes
- [ ] Edit file → commit → push
- [ ] Verify token auth works
- [ ] Check sync with auto-sync enabled

### 6.4 Mobile-Specific Validation
- [ ] No Node.js module errors
- [ ] No shell execution errors
- [ ] Token persists across app restarts
- [ ] Sync works on both WiFi and cellular
- [ ] Performance acceptable (not freezing UI)

**Deliverable**: Working plugin on desktop and mobile, all tests pass.

## Phase 7: Cleanup & Documentation

### 7.1 Remove simple-git Artifacts
- Delete `simple-git` from package.json
- Remove any Node `fs`/`path` imports from plugin code
- Verify no child_process or shell exec calls remain

### 7.2 Update Documentation
- Update README.md with mobile support info
- Document token-based auth setup
- Add troubleshooting section for common errors
- Update screenshots (if applicable)

### 7.3 Memory Bank Update
- Mark T1 as complete
- Update tasks.md
- Create session summary

**Deliverable**: Clean codebase, updated docs, merged to main.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| isomorphic-git performance poor on large repos | Medium | Medium | Shallow clones, exclude large files |
| Vault API insufficient for binary git objects | Medium | High | Use adapter.readBinary/writeBinary |
| Mobile auth storage not available | Low | High | Fallback to Obsidian settings |
| CORS issues on mobile | Medium | Medium | Use requestUrl, document proxy option |
| Build size too large | Low | Medium | Code splitting, tree shaking |
| Conflict resolution UX poor | High | Medium | Document manual resolution, add conflict UI |

## Timeline Estimate

| Phase | Estimated Time | Cumulative |
|-------|---------------|------------|
| Phase 2: Branch & Dependencies | 30 min | 30 min |
| Phase 3: Vault FS Adapter | 2-3 hours | 3-4 hours |
| Phase 4: GitManager Rewrite | 3-4 hours | 6-8 hours |
| Phase 5: HTTP Client & Auth | 1-2 hours | 7-10 hours |
| Phase 6: Integration & Testing | 2-3 hours | 9-13 hours |
| Phase 7: Cleanup & Docs | 1 hour | 10-14 hours |

**Total**: ~10-14 hours of focused work

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-30 | Use isomorphic-git over simple-git | Mobile compatibility |
| 2026-05-30 | Keep existing UI/settings code | Only swap engine, minimize risk |
| 2026-05-30 | Use token-based auth on mobile | No SSH agent on mobile |
| 2026-05-30 | Implement VaultFsAdapter | Bridge Obsidian API to isomorphic-git fs |
| 2026-05-30 | Shallow clones (`depth: 1`) | Performance on mobile |

*Last Updated: 2026-05-30 17:45:00 IST*
