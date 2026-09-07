# System Patterns

*Last Updated: 2026-09-07 05:29:49 IST*

## Component ownership

Each app feature owns its UI, state, operation calls, and focused tests.

## Direct operations

An operation returns a small success or failure result. The component that
started it decides what to show. There is no global event bus by default.

## Boundaries

Obsidian APIs, filesystem access, network access, and Git access stay behind
small adapters so the components can be tested without Obsidian.

## KISS rule

Prefer one clear path over shared caches, generic coordinators, or speculative
recovery. Add a layer only after a reproducible user-facing failure requires it.

## Refresh ownership

Vault-wide Changes scans are authoritative but explicit: they run on initial or
context refresh and through the Refresh action. Successful known mutations use
targeted reconciliation or local state updates; uncertain states must expose a
manual refresh prompt rather than silently starting another full scan.
