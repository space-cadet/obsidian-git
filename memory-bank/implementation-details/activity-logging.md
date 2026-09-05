# T5: Activity and Logging

## Purpose

Explain recent plugin actions in a simple Activity view.

## Initial scope

- Activity list
- Operation success and failure messages
- Small persisted history
- Clear and export actions

## Implemented state

The Activity tab retains up to 50 in-memory entries for startup, local
repository reads and errors, settings saves, and updater events. Persistence,
clear, and export remain pending.

## KISS boundary

Use one straightforward log source. Do not add a general event system,
multi-level retention policy, or analytics layer without a demonstrated need.

## Completion evidence

Current operations appear once with a useful result. Reopen persistence remains
open because the initial implementation keeps activity in memory only.
