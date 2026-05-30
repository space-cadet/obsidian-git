# Active Context

*Last Updated: 2026-05-30 17:45:00 IST*

## Current Focus
**T1 — Port GitManager to isomorphic-git**
- Status: 🔄 IN PROGRESS — Phase 1 Complete, Design Done
- Branch: Create `isomorphic-git` from `simple-git`
- Current phase: Phase 1.5 (Design & Planning) — ✅ Complete
- Next phase: Phase 2 (Branch Setup & Dependency Swap)

## Active Tasks
- **[T1]**: 🔄 **IN PROGRESS** — Port GitManager to isomorphic-git for mobile compatibility
  - Phase 1: Foundation & Research ✅
  - Phase 1.5: Design & Planning ✅
  - Phase 2: Branch Setup & Dependency Swap ⏳
  - Phase 3: Vault FS Adapter (Critical) ⏳
  - Phase 4: GitManager Rewrite ⏳
  - Phase 5: HTTP Client & Auth ⏳
  - Phase 6: Integration & Testing ⏳
  - Phase 7: Cleanup & Documentation ⏳

## Next Steps
1. **Phase 2**: Create `isomorphic-git` branch, swap dependencies in package.json
2. **Phase 3**: Implement `VaultFsAdapter.ts` — bridge Obsidian Vault API to isomorphic-git fs
3. **Phase 4**: Rewrite `gitManager.ts` with isomorphic-git API, preserve public interface
4. **Phase 5**: Token-based auth, mobile secure storage, settings UI updates
5. **Phase 6**: Integration testing on desktop and mobile
6. **Phase 7**: Cleanup, docs, merge to main

## Current Decisions
- **Keep existing UI/settings code** — `main.ts`, settings tab, ribbon icon all work; only swap the engine
- **Token-based auth on mobile** — No SSH agent on iOS/Android, use HTTPS + PAT
- **VaultFsAdapter pattern** — Bridge Obsidian Vault API to isomorphic-git's fs interface
- **Shallow clones (`depth: 1`)** — Performance optimization for mobile
- **Fast-forward only pulls** — Safe default, avoid merge conflicts on mobile
- **Obsidian `requestUrl` for HTTP** — Handles CORS, works on all platforms
- **isomorphic-git over simple-git** — Pure JS, no binary dependency, mobile-compatible

## Architecture References
- `memory-bank/techContext.md` — Technology stack, mobile constraints, isomorphic-git limitations
- `memory-bank/systemPatterns.md` — Adapter pattern, auth strategy, error handling, mobile patterns
- `implementation-details/isomorphic-git-port-plan.md` — 7-phase detailed implementation plan
- `tasks/T1.md` — Granular task breakdown with deliverables and timeline

## Session Context
- **Session**: 2026-05-30 afternoon
- **Duration**: ~2.5 hours (planning + setup)
- **Commits**: `f16eb6c`, `cc4ef43` — memory-bank initialization and updates
- **Pushed to**: origin/simple-git
- **Git permissions**: Fixed (`.git/index` group ownership resolved)
- **Ready for**: Phase 2 implementation

## Risk Watch
- **isomorphic-git performance** — May be slow on large repos; mitigated by shallow clones
- **Vault API binary handling** — `.git/objects/` need binary read/write; using `adapter.readBinary/writeBinary`
- **Mobile auth storage** — May not have Keychain access; fallback to Obsidian settings
- **CORS on mobile** — `requestUrl` should handle this, but needs validation

## Notes for Next Session
- All design docs are in place, ready to start coding
- Focus should be Phase 2 (branch + deps) then immediately Phase 3 (VaultFsAdapter)
- Critical path is Phase 3 — everything else builds on the fs adapter
- Estimated total work remaining: 10-14 hours across Phases 2-7
