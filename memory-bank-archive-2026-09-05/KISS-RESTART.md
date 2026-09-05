# KISS Restart

## Rule

Every feature begins as the smallest direct user workflow. Add a layer only
when a measured, reproducible failure cannot be solved without it.

## First implementation order

1. Open a sidebar with Changes, Activity, and one Pull button.
2. Read Activity once on opening its tab; append live entries directly.
3. Read status only on explicit refresh, a bounded vault-event debounce, or a
   completed Git action.
4. Pull: fetch, compare changed paths only, reject only conflicting local
   paths, then fast-forward and checkout.
5. Show the actual pull step and elapsed time. Never invent progress phases.

## Prohibited until proven necessary

- Plugin-lifetime caches and read models.
- Generic operation coordinators.
- Render generations and multiple invalidation systems.
- Background status polling.
- Full-vault status scans in the pull safety check.

## Acceptance

No source test closes acceptance. Verify the real Android vault: Log entries
after plugin load, same-state pull, changed pull, conflict protection, elapsed
phase display, scrolling, focus, and narrow sidebar layout.
