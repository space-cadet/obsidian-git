# Data Transfer Tracking Investigation (T35d Follow-up)

*Date: 2026-08-13*
*Investigation: HTTP Range requests, XMLHttpRequest progress, and Vinzent03/obsidian-git source analysis*

---

## 1. HTTP Range Requests on Git Smart HTTP

**Finding: NOT viable for packfile downloads.**

Git smart HTTP protocol:
1. `GET /info/refs?service=git-upload-pack` — small ref advertisement
2. `POST /git-upload-pack` — negotiation + packfile download

**Why Range doesn't work:**
- Packfile download uses **POST**, not GET. HTTP Range is only defined for GET/HEAD.
- Even if a server accepted Range on POST, Git protocol requires client-server negotiation (client sends "want" + "have" lines, server computes delta pack). You can't resume from a byte offset without re-negotiating.
- GitHub's smart HTTP endpoints do not advertise `Accept-Ranges`.

**Verdict:** Strategy rejected. No code changes needed.

---

## 2. XMLHttpRequest Progress in Obsidian Mobile

**Finding: Depends on Obsidian's CapacitorHttp config (app-level, not controllable by plugins).**

From Capacitor documentation:
- Capacitor can patch `XMLHttpRequest` and `fetch` to use native libraries when `CapacitorHttp: { enabled: true }` is set in `capacitor.config`
- When patched, `XMLHttpRequest.onprogress` provides real byte-level progress
- **BUT**: This is an app-level configuration. Plugin authors cannot enable it — only Obsidian app developers can.

**Test to run in Obsidian mobile Developer Console:**
```javascript
const xhr = new XMLHttpRequest();
console.log('onprogress supported:', 'onprogress' in xhr);
```

**If `true`**: Obsidian has CapacitorHttp enabled → real progress events available.
**If `false`**: Standard web XHR (no native progress) → current `requestUrl` approach is optimal.

**Next step:** Deepak to test in Obsidian mobile and report back.

---

## 3. Vinzent03/obsidian-git Source Analysis

**Key finding: The most popular Obsidian Git plugin does NOT support mobile for actual git operations.**

### Architecture Comparison

| Aspect | Vinzent03 Plugin | Our Plugin |
|---|---|---|
| **Git engine** | `simple-git` (Node.js wrapper around native `git` CLI) | `isomorphic-git` (pure JS) |
| **Desktop** | Native git CLI | isomorphic-git |
| **Mobile** | **Does NOT work** for clone/pull/push | Works via `requestUrl` |
| **Progress** | Native git CLI progress | Custom progress modal |

### What Vinzent03 Does Well (potential adoption)
1. **Settings UI** — Extensive git behavior configuration
2. **Conflict resolution** — Built-in diff/merge UI
3. **History/branch visualization** — Graph view
4. **Status bar integration** — Branch, modified count, ahead/behind
5. **Command palette** — Comprehensive commands

### What Our Plugin Does Better
1. **Mobile support** — isomorphic-git + `requestUrl` works on iOS/Android
2. **No native dependency** — Doesn't require git CLI
3. **GitHub API fallback** — REST API for commit history when shallow

---

## Recommendations

### Immediate
- [ ] **Test XHR progress in Obsidian mobile** (Deepak)
- [ ] **Document limitation** in README: "Progress shows response processing, not live network download, due to Obsidian mobile API constraints"

### Short-term
- [ ] **Implement indeterminate spinner** — During `requestUrl` network wait, show spinning indicator instead of stuck progress bar. Switch to determinate after response arrives.

### Medium-term (if XHR progress works)
- [ ] **Add XHR transport fallback** — Implement `XMLHttpRequest`-based transport with real `onprogress` events. Use when available, fall back to `requestUrl` when not.

---

## Research Sources

1. Capacitor HTTP Plugin docs: https://capacitorjs.com/docs/apis/http
2. Capacitor File Transfer Plugin: https://capacitorjs.com/docs/apis/file-transfer
3. GitHub Discussions (Capacitor progress): https://github.com/ionic-team/capacitor/discussions/5077
4. Vinzent03/obsidian-git source: https://github.com/Vinzent03/obsidian-git
   - `src/main.ts` — Plugin initialization, desktop/mobile split
   - `src/types.ts` — `GitProgress` interface, settings types
   - `src/constants.ts` — Default settings
   - `src/utils.ts` — Helper functions
