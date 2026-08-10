# Git HTTP Client Architecture

*Created: 2026-05-30 21:35:00 IST*
*Last Updated: 2026-05-30 21:35:00 IST*

## Overview

The Git HTTP client uses Obsidian's `requestUrl` API instead of `fetch` or a proxy server. This enables Git operations on both desktop and mobile without CORS issues.

## Why requestUrl?

| Approach | Desktop | Mobile | CORS | Notes |
|----------|---------|--------|------|-------|
| `fetch()` | ✅ | ✅ | ❌ Blocked by Git hosts | Requires proxy server |
| Proxy server | ✅ | ❌ Cannot run on mobile | Separate Node.js process |
| `requestUrl` | ✅ | ✅ | ✅ Bypassed entirely | Native Capacitor bridge |

`requestUrl` runs at the native OS level, not the WebView level. It bypasses all CORS restrictions and works identically on desktop (Electron) and mobile (Capacitor).

## Architecture

```
isomorphic-git → GitHttpClient.request() → requestUrl() → Native HTTP → Git Server
                    ↓
              (collectBody) → (toAsyncIterator)
```

### Request Flow

1. **isomorphic-git** calls `http.request(config)` with:
   - `url`: Git endpoint URL
   - `method`: GET or POST
   - `headers`: Git protocol headers
   - `body`: Async iterable of Uint8Arrays (for POST)

2. **GitHttpClient** processes:
   - Adds Basic Auth header from credentials
   - Collects async body into single ArrayBuffer via `collectBody()`
   - Calls `requestUrl()` with `throw: false`

3. **requestUrl** executes:
   - Native HTTP request via Capacitor bridge
   - Returns `RequestUrlResponse` with `status`, `arrayBuffer`, `headers`

4. **GitHttpClient** converts response:
   - Wraps `arrayBuffer` into async iterable via `toAsyncIterator()`
   - Returns isomorphic-git-compatible response object

## Key Methods

### collectBody()

```typescript
private async collectBody(body: AsyncIterable<Uint8Array>): Promise<ArrayBuffer>
```

Merges multiple Uint8Array chunks into a single ArrayBuffer. Needed because `requestUrl` expects a single `body` parameter, not an async iterable.

**Algorithm:**
1. Iterate through all chunks
2. Sum total byte length
3. Allocate new Uint8Array of total size
4. Copy each chunk into result array at offset

### toAsyncIterator()

```typescript
private toAsyncIterator(arrayBuffer: ArrayBuffer): AsyncIterable<Uint8Array>
```

Converts an ArrayBuffer into an async iterable that yields a single Uint8Array. This is the reverse of `collectBody()` — isomorphic-git expects `body` as an async iterable.

**Usage:**
```javascript
return {
  [Symbol.asyncIterator]: async function* () {
    yield new Uint8Array(arrayBuffer);
  }
};
```

## Authentication

Basic Auth header is constructed from credentials:

```typescript
const auth = btoa(`${username}:${password}`);
headers['Authorization'] = `Basic ${auth}`;
```

This supports both password and personal access token (PAT) authentication.

## Error Handling

`requestUrl` is called with `throw: false` to prevent throwing on HTTP error status codes. This lets isomorphic-git parse Git protocol errors (like 401 Unauthorized) rather than getting a generic HTTP exception.

## Limitations

- **No streaming**: `requestUrl` loads the entire response into memory. Large pack files could be an issue, but unlikely for typical vaults.
- **Binary handling**: `arrayBuffer` must be used for pack files; `text` would corrupt binary data.

## Architecture Review Update (2026-08-11)

The current `arrayBufferToAsyncIterable()` helper yields bounded zero-copy
views after `requestUrl()` has already materialized the complete response. It
therefore reduces additional parser copies but does not provide true streaming
or guarantee that large mobile responses will fit in memory.

All GitHub REST fallback calls should use the same native transport boundary as
Git smart HTTP. Browser `fetch()` is not an equivalent mobile-safe path.

T35d owns the transport and mobile-support follow-up. Until a genuinely
streaming transport or a different Git implementation is available, mobile
repository-size limits and pack-index limitations must be documented as
acceptance boundaries rather than treated as solved by chunking alone.

## References

- `src/gitManager.ts` — GitHttpClient implementation
- Obsidian API docs: `requestUrl` function
- isomorphic-git docs: HTTP client interface
