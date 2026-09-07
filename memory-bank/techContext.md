# Technical Context

*Last Updated: 2026-09-07 05:29:49 IST*

- Target host: Obsidian desktop and mobile.
- Language: TypeScript.
- Starting point: clean implementation on `codex/kiss-restart`.
- No legacy plugin source is part of the new implementation.
- Git uses `isomorphic-git` behind an Obsidian `DataAdapter` filesystem bridge;
  HTTP(S) transport uses Obsidian's request bridge and credentials use
  SecretStorage. Activity persists as bounded plain text in `activity.log`.
- Verification will use focused tests, temporary repositories, production
  builds, and real Obsidian acceptance.
