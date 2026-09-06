# T5: Activity and Logging

## Purpose

Explain recent plugin actions in a simple Activity view.

## Initial scope

- Activity list
- Operation success and failure messages
- Small persisted history
- Clear and export actions

## Implemented state

The Log tab retains the latest 50 entries in plugin data. Each entry stores a
message, timestamp, and severity level (`DEBUG`, `INFO`, `METRIC`, or `ERROR`).
The view renders full date/time stamps, severity badges, alternating rows, and
wrapped messages inside the scrollable content area. Writes are serialized so
activity and settings updates do not overwrite one another.

Performance metrics are recorded in the same Log tab. Repository refreshes
include timings for repository inspection, Changes, local commits, and remote
commits, along with result counts. Tab switches, staging actions, and remote
operations record their total elapsed time. Push also records the separate
working-tree status-scan duration.

## KISS boundary

Use one straightforward log source. Do not add a general event system,
multi-level retention policy, or analytics layer without a demonstrated need.

## Completion evidence

The user verified the pushed build and confirmed that Log entries persist and
render correctly, including remote-operation diagnostics and Git-style result
details. Clear and export remain outside the current scope.
