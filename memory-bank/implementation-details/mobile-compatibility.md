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
