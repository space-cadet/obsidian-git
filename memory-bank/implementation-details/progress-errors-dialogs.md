# T8: Progress, Errors, and Dialogs

## Purpose

Make active operations and failures understandable without adding a framework.

## Initial scope

- Operation progress
- Cancel action where supported
- Confirmation dialog for destructive actions
- Error display with an actionable message

## KISS boundary

Show only phases and values the underlying operation actually provides. Do not
invent transfer metrics or add generic workflow orchestration.

## Completion evidence

The user can tell what is happening, stop a supported operation, and understand
what to do after a failure.
