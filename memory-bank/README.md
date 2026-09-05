# Obsidian Git Rebuild Memory Bank

*Initialized: 2026-05-09 23:15:48 GMT+5:30*

## Overview

This directory records the clean, component-based rebuild of Obsidian Git.
The previous Memory Bank is archived at the repository root. The new plugin is
being built from scratch; old implementation details are reference material,
not constraints.

## Getting Started

### 1. Update Core Files

**projectbrief.md** - Project overview
- Project name and description
- Core objectives
- Key constraints or requirements
- Success metrics

**tasks.md** - Task registry
- Create entries for planned tasks
- Use format: Task ID, title, status, priority
- Update as work progresses

**.cursorrules** - Development guidelines
- Project coding standards
- Architecture patterns
- Technology stack details
- Important conventions

### 2. Database Setup (if using database features)

After initializing the memory bank, set up the database:

```bash
cd memory-bank/database
pnpm install
./run-all.sh
node query.js stats
```

### 3. File Structure Reference

```
memory-bank/
├── README.md              # This file
├── activeContext.md       # Current task context
├── changelog.md           # Project changes
├── edit_history.md        # File modification log
├── errorLog.md            # Error tracking
├── progress.md            # Implementation status
├── projectbrief.md        # Project overview
├── session_cache.md       # Session tracking
├── tasks.md               # Task registry
├── techContext.md         # Technical details
├── .cursorrules           # Development guidelines
├── tasks/                 # Individual task files
├── sessions/              # Session records
├── templates/             # File templates
├── database/              # Database and parser scripts
├── implementation-details/ # Technical notes
└── archive/               # Completed/archived items
```

### 4. Working with the Memory Bank

When using with an AI assistant:

1. Reference memory bank files in prompts
2. Request specific sections when needed
3. Update files after completing work
4. Maintain activeContext.md and session_cache.md

### 5. Current Starting Point

1. Build **T1: Plugin UI Shell**.
2. Build **T2: Settings Panel**.
3. Verify the visual anchor in Obsidian.
4. Add the next component only after the first two are usable.
