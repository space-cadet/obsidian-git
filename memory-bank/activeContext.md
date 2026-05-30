# Active Context

*Last Updated: 2026-05-30 16:05:00 IST*

## Current Focus
**T1 — Port GitManager to isomorphic-git**
- Status: 🔄 IN PROGRESS
- Branch: Create `isomorphic-git` from `simple-git`
- Current phase: Planning and dependency setup

## Active Tasks
- **[T1]**: 🔄 **IN PROGRESS** — Port GitManager to isomorphic-git for mobile compatibility

## Next Steps
1. Create `isomorphic-git` branch
2. Replace `simple-git` with `isomorphic-git` in package.json
3. Rewrite `gitManager.ts` with isomorphic-git API
4. Replace Node fs/path with Obsidian Vault API
5. Implement mobile auth handling
6. Test on desktop and mobile

## Current Decisions
- **Keep existing UI/settings code** — `main.ts`, settings tab, ribbon icon all work
- **Only swap the engine** — GitManager is the only component that needs rewriting
- **Text files stay primary** until DB backfill verified (from mb-core convention)

## Session Context
- **Session**: 2026-05-30 afternoon
- **Duration**: ~1 hour
- **Commits**: `f16eb6c` — docs: initialize memory-bank following mb-core v6.12 protocol
- **Pushed to**: origin/simple-git
