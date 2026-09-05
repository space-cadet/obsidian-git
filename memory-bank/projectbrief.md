# Project Brief

## Obsidian Git Sync Plugin

A Git synchronization plugin for Obsidian that works on desktop and mobile platforms using isomorphic-git, a pure JavaScript implementation of Git.

## Core Components

- **Git Backend** (`src/backend/gitBackend.ts`): Core Git operations — clone, pull, add, commit, push, status
- **Plugin Main** (`src/main.ts`): Obsidian plugin lifecycle, settings UI, auto-sync scheduler, ribbon icon
- **Logger** (`src/logger.ts`): Winston-based structured logging with configurable levels
- **Proxy Server** (`proxy/proxyServer.js`): CORS proxy for Git HTTP requests on mobile

## Key Features

- Synchronize Obsidian vault with a Git repository
- Works on desktop (Windows, macOS, Linux) and mobile (iOS, Android)
- Automatic and manual sync options
- Configurable commit messages with `{{date}}` placeholder
- Status bar indicator for sync status
- Settings UI with connection test and manual sync buttons

## Technical Stack

- **Language**: TypeScript
- **Build**: esbuild
- **Git Engine**: isomorphic-git + @isomorphic-git/lightning-fs
- **HTTP Client**: isomorphic-git/http/web via custom proxy
- **Logging**: Winston
- **Platform**: Obsidian Plugin API

## File Organization

```
/src/
  main.ts          — Plugin entry point, settings, auto-sync
  gitManager.ts    — Git operations wrapper
  logger.ts        — Structured logging
/proxy/
  proxyServer.js   — CORS proxy for Git HTTP
```

## Project Status

- **Version**: 1.0.0
- **Phase**: Initial development / stabilization
- **License**: MIT

Last Updated: 2026-05-30
