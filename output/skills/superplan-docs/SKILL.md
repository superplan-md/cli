---
name: superplan-docs
description: Use when code, commands, install flow, help text, or user-visible behavior changed and docs or durable context may now be inaccurate.
---

# Docs Sync

## Overview

Keep the public story aligned with the real product.

## Trigger

Use when:

- command behavior changed
- install or update flow changed
- a feature was added, removed, or renamed
- release readiness depends on docs and help being accurate

## Core Rules

- update the smallest set of docs that own the changed truth
- keep README, `context/context.md`, and help output aligned
- grep for stale commands, labels, or old assumptions before declaring docs done
- prefer concrete commands and examples over vague prose
- call out one-time migration or bootstrap edges explicitly when they matter to users

## Forbidden Behavior

- leaving stale docs because the code changed correctly
- updating docs without checking the actual CLI surface
- burying breaking or user-visible behavior changes in vague wording

## Handoff

Likely follow-ons:

- `superplan-release` when docs were part of a ship gate
- `superplan-verify` for targeted proof like `rg`, `--help`, or install-flow checks
