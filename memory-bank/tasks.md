# Memory Bank — Obsidian Git Sync Plugin

*Created: 2026-05-28 20:16:00 IST*
*Last Updated: 2026-09-05 15:04:04 IST*

## Overview

Git sync plugin for Obsidian using isomorphic-git. Works on desktop and mobile without proxy servers. Uses Obsidian's `requestUrl` native API for HTTP operations.

## Active Tasks

| ID | Title | Status | Priority | Started | Dependencies | Details |
|----|-------|--------|----------|---------|--------------|---------|
| T29 | obsidian-git Plugin — sidebar UX published; release acceptance | 🔄 | HIGH | 2026-05-31 | T1-T6 | [Details](tasks/T29.md) |
| T29a | Full Sidebar UI Redesign and Visual Acceptance | 🔄 | HIGH | 2026-09-02 | T29 | [Details](tasks/T29a.md) |
| T30 | Remote Commits View | ✅ | MEDIUM | 2026-06-01 | T29 | [Details](tasks/T30.md) |
| T31 | Branch Tree View | ⏳ BACKLOG | LOW | 2026-06-01 | T29 | [Details](tasks/T31.md) |
| T32 | Mobile Crash Fix + Progress | ✅ | HIGH | 2026-06-01 | T29 | [Details](tasks/T32.md) |
| T33 | Progress Modal + UI Fixes | ✅ | HIGH | 2026-06-02 | T29 | [Details](tasks/T33.md) |
| T34 | Remote Authentication for Obsidian Git | 🔄 | HIGH | 2026-08-10 | - | [Details](tasks/T34.md) |
| T34a | PAT Validation and Repository-Access Diagnostics | 🔄 | HIGH | 2026-08-10 | T34 | [Details](tasks/T34a.md) |
| T34b | GitHub Device-Flow Authentication | ⏸️ | MEDIUM | 2026-08-10 | T34a | [Details](tasks/T34b.md) |
| T34c | Android/Desktop Authentication Acceptance Tests | ⏸️ | HIGH | 2026-08-10 | T34a, T34b | [Details](tasks/T34c.md) |
| T35 | Plugin Reliability, Security, Lifecycle, Transport, Updater, and Test Follow-up | 🔄 | HIGH | 2026-08-11 | T29, T34 | [Details](tasks/T35.md) |
| T35a | Credential Safety and Git Staging Boundaries | 🔄 | HIGH | 2026-08-11 | T35, T34a | [Details](tasks/T35a.md) |
| T35b | Git Mutation Concurrency and Cancellation | 🔄 | HIGH | 2026-08-11 | T35, T29 | [Details](tasks/T35b.md) |
| T35c | Repository Initialization and Destructive-Operation Safety | 🔄 | HIGH | 2026-08-11 | T35, T29 | [Details](tasks/T35c.md) |
| T35d | Mobile and Remote Transport Reliability | 🔄 | HIGH | 2026-08-11 | T35, T29, T34c | [Details](tasks/T35d.md) |
| T35e | Updater Integrity and Release Artifact Consistency | 🔄 | HIGH | 2026-08-11 | T35, T29 | [Details](tasks/T35e.md) |
| T35f | Test, CI, and Documentation Alignment | 🔄 | MEDIUM | 2026-08-11 | T35, T29 | [Details](tasks/T35f.md) |
| T36 | Fork and Maintain isomorphic-git | 🔄 | HIGH | 2026-09-03 | T29, T35b, T35d, T35f | [Details](tasks/T36.md) |
| T37 | Tentative Plugin Rewrite Feasibility and User-Workflow Assessment | ⏸️ | MEDIUM | 2026-09-03 | T35, T35b, T35c, T35d, T35f, T36 | [Details](tasks/T37.md) |
| T38 | Current Product Specification and Rewrite PRD Foundation | 🔄 | HIGH | 2026-09-04 | T29, T29a, T34, T35, T36 | [Details](tasks/T38.md) |
| T39 | KISS Git Backend Rewrite | 🔄 | HIGH | 2026-09-04 | T29, T29a, T34, T35, T36, T37, T38 | [Details](tasks/T39.md) |

## Completed Tasks

| ID | Title | Status | Priority | Started | Completed | Dependencies | Details |
|----|-------|--------|----------|---------|-----------|--------------|---------|
| T1 | Core Git Integration | ✅ | HIGH | 2026-05-28 | 2026-05-30 | - | [Details](tasks/T1.md) |
| T2 | Plugin Commands & UI | ✅ | HIGH | 2026-05-28 | 2026-05-30 | T1 | [Details](tasks/T2.md) |
| T3 | Mobile Compatibility | ✅ | HIGH | 2026-05-30 | 2026-05-30 | T1, T2 | [Details](tasks/T3.md) |
| T4 | Auto-sync & Background | ✅ | MEDIUM | 2026-05-28 | 2026-05-30 | T1, T2 | [Details](tasks/T4.md) |
| T5 | Error Handling & Logging | ✅ | MEDIUM | 2026-05-28 | 2026-05-30 | - | [Details](tasks/T5.md) |
| T6 | Git Sidebar UI | ✅ | MEDIUM | 2026-05-28 | 2026-05-31 | T1, T2 | [Details](tasks/T6.md) |

## Status Summary

- **Active parent tasks**: 6 (T29, T34, T35, T36, T38, T39); **active child tasks**: T29a, T34a, T35a, T35b, T35c, T35d, T35e, T35f
- **Completed**: 6 (T1-T6) + 3 sub-tasks (T30, T32, T33)
- **Paused**: 3 (T34b, T34c, T37); **planned follow-up children**: none
- **Backlog**: 1 (T31)
- **Total**: 27
