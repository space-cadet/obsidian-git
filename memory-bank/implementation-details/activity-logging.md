# T5: Activity and Logging

## Purpose

Explain recent plugin actions in a simple Activity view.

## Initial scope

- Activity list
- Operation success and failure messages
- Small persisted history
- Clear and export actions

## KISS boundary

Use one straightforward log source. Do not add a general event system,
multi-level retention policy, or analytics layer without a demonstrated need.

## Completion evidence

An operation appears once with a useful result and remains understandable after
the plugin is reopened.
