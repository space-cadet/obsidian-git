# System Patterns

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
