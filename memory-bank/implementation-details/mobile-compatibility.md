# Mobile Compatibility Strategy

*Created: 2026-05-30 21:35:00 IST*
*Last Updated: 2026-05-30 21:35:00 IST*

## Overview

The plugin must work on mobile (iOS/Android WebView) where Node.js APIs are unavailable. This requires removing or replacing all Node.js-specific dependencies.

## Problem Analysis

### Node.js Dependencies Found

| Dependency | Source | Mobile Issue | Solution |
|------------|--------|--------------|----------|
| `require("buffer")` | `safe-buffer` (via winston → readable-stream) | No `require()` in WebView | Replace winston with simple logger |
| `process.cwd()` | `path` polyfill (via esbuild) | `process` undefined or incomplete | Stub `process` in esbuild config |
| `process.env` | isomorphic-git internal | `process.env` undefined | Define `process.env` in esbuild config |

### Dependency Chain

```
winston
└── readable-stream
    └── safe-buffer
        └── require("buffer")  ← FAILS on mobile
```

## Solution: Replace winston

**Why not polyfill?**
- `readable-stream` is a large polyfill of Node.js streams
- Adds ~50KB+ to bundle size
- Dead weight — we don't need Node streams in a browser plugin

**Simple Logger Implementation**

```typescript
enum LogLevel { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3 }

class Logger {
  private level: LogLevel = LogLevel.INFO;
  
  setLogLevel(level: LogLevel) { this.level = level; }
  
  debug(component: string, message: string) {
    if (this.level <= LogLevel.DEBUG) console.log(`[GitSync:DEBUG] [${component}] ${message}`);
  }
  
  info(component: string, message: string) {
    if (this.level <= LogLevel.INFO) console.log(`[GitSync:INFO] [${component}] ${message}`);
  }
  
  warn(component: string, message: string) {
    if (this.level <= LogLevel.WARN) console.warn(`[GitSync:WARN] [${component}] ${message}`);
  }
  
  error(component: string, message: string, error?: Error) {
    if (this.level <= LogLevel.ERROR) console.error(`[GitSync:ERROR] [${component}] ${message}`, error);
  }
}

export const log = new Logger();
export { LogLevel };
```

## Components That Work on Mobile

| Component | Status | Notes |
|-----------|--------|-------|
| isomorphic-git | ✅ | Pure JavaScript, no Node deps |
| LightningFS | ✅ | Uses IndexedDB, available in WebView |
| `requestUrl` | ✅ | Native Capacitor bridge, bypasses CORS |
| Obsidian API | ✅ | Provided by Obsidian app |

## Build Verification

After building, verify no Node.js builtins in bundle:

```bash
grep -n 'require("buffer")' main.js    # Should be 0
grep -n 'process.cwd' main.js            # Should be 0  
grep -n 'process.env' main.js            # Should be 0
grep -n 'require("path")' main.js       # Should be 0 (or path-browserify)
```

## If process Stub Needed

Add to `esbuild.config.mjs`:

```javascript
define: {
  'process.env.NODE_ENV': '"production"',
  'process.cwd': '(() => "/")',
  'process.platform': '"browser"',
  'process.version': '"v16.0.0"'
}
```

Or inject via banner:

```javascript
banner: {
  js: `if (typeof process === 'undefined') { 
    globalThis.process = { env: {}, cwd: () => '/', platform: 'browser' }; 
  }`
}
```

## Testing on Mobile

1. Build plugin
2. Copy `main.js`, `manifest.json`, `styles.css` to mobile vault
3. Enable plugin in Obsidian mobile
4. Run "Test isomorphic-git compatibility" command
5. Verify all 7 tests pass

## References

- `src/logger.ts` — Simple Logger implementation
- `memory-bank/tasks/T3.md` — Mobile compatibility task
- GitHub issue: isomorphic-git/isomorphic-git#2263

## Current Support Boundary (2026-08-11)

The historical mobile bundle and basic Git flows were tested successfully, but
large-repository support remains conditional. The native HTTP response is still
fully buffered before the 64 KiB iterator yields views, and the mobile pack
index strategy is not fully resolved. One GitHub commit-file fallback also uses
browser `fetch()` and must be aligned with the native transport.

T35d owns the follow-up. T29 mobile release acceptance must record actual
Android/iOS results for clone, pull, push, progress, remote history, commit
expansion, large responses, and pack-index behavior before the stable release
gate closes.

## Existing Repository Ref-Resolution Failure — 2026-09-03

Real mobile testing of the existing non-empty `typora-notes` repository reports
`Could not find refs/heads/main` during the index-repair dry run, while the
health panel reports `main` with no commits. This is unresolved and must not be
classified as a fixed mobile issue from desktop or automated tests.

The next investigation must compare the mobile adapter's reads of `.git/HEAD`,
`refs/heads/main`, and `refs/remotes/origin/main` with the configured branch and
remote state. A recovery action must protect the existing vault and `.git`
state before writing refs or checking out files.
