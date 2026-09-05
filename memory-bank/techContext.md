# Technical Context

- Target host: Obsidian desktop and mobile.
- Language: TypeScript.
- Starting point: clean implementation on `codex/kiss-restart`.
- No legacy plugin source is part of the new implementation.
- Git library, transport, and persistence choices remain open until their
  component needs are implemented.
- Verification will use focused tests, temporary repositories, production
  builds, and real Obsidian acceptance.
