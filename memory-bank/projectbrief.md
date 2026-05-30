# Project Brief

*Last Updated: 2026-05-30 16:05:00 IST*

## Project Overview
Obsidian Git Plugin — A Git synchronization plugin for Obsidian that works on desktop and mobile platforms. The current implementation uses `simple-git` (Node.js wrapper around git CLI) which does not work on mobile. The goal is to port to `isomorphic-git` (pure JavaScript git implementation) to enable mobile support.

**Canonical Location**: `~/code/obsidian-git/`

## Goals
- Provide reliable Git sync on desktop (Windows, macOS, Linux) and mobile (iOS, Android)
- Support automatic and manual sync options
- Offer configurable commit messages and status bar indicators
- Maintain full version history and conflict resolution capabilities

## Core Features
- Synchronize Obsidian vault with a Git repository
- Auto-sync with configurable intervals
- Manual sync via ribbon icon
- Status bar indicator for sync status
- Settings UI for credentials, branch, and sync options
- Git log and changed files view in sidebar

## Project Structure
```
obsidian-git/
├── src/
│   ├── main.ts              # Plugin entry point
│   ├── gitManager.ts          # Git operations (NEEDS PORTING)
│   ├── gitSyncView.ts         # Sidebar view for git status/log
│   ├── logger.ts              # Winston-based logging
│   └── mobile-adapter.ts      # Mobile-specific optimizations (STUBS)
├── proxy/                     # Proxy server for auth (desktop)
├── manifest.json              # Obsidian plugin manifest
├── package.json               # Dependencies (simple-git → isomorphic-git)
├── esbuild.config.mjs         # Build configuration
└── README.md                  # Documentation
```

## Key Components
- **GitManager**: Core git operations. Currently uses `simple-git`. Must be rewritten for `isomorphic-git`.
- **GitSyncView**: Sidebar UI showing git status, log, and changed files.
- **MobileAdapter**: Mobile-specific optimizations (battery, auth, background sync).
- **Logger**: Debug/info logging system.

## Current Status
- Overall Progress: 30% (desktop works, mobile broken)
- Active Tasks: 1
- Current Focus: Port GitManager from simple-git to isomorphic-git

## Task Tracking
Tasks are tracked in `tasks.md` with the following priority structure:
- **High Priority**: Core functionality, mobile compatibility
- **Medium Priority**: UI improvements, logging
- **Low Priority**: Nice-to-have features

## Memory Bank Organization
- `/memory-bank/`: Core documentation files
- `/memory-bank/tasks/`: Individual task files
- `/memory-bank/sessions/`: Session tracking
- `/memory-bank/edits/`: Edit chunks

## Implementation Guidelines
- Use Obsidian `Vault` API instead of Node `fs`/`path` for mobile compatibility
- Use `normalizePath()` from Obsidian for cross-platform paths
- Keep plugin size minimal — isomorphic-git is ~500KB gzipped
- Test on both desktop and mobile before release

## External Dependencies
- **obsidian**: latest — Obsidian API
- **isomorphic-git**: ^1.0.0 — Pure JS git (replacing simple-git)
- **esbuild**: ^0.20.0 — Build tool
- **typescript**: ^5.3.3 — Type system

## Notes
- Current branch: `simple-git` (legacy, desktop-only)
- Target branch: `isomorphic-git` (mobile-compatible)
- The proxy server approach for authentication may need rethinking for mobile
