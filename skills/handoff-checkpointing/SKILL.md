---
name: handoff-checkpointing
description: Use when work is about to pause, transfer, or survive context loss and the next agent needs a concise, high-signal checkpoint.
---

# Handoff Checkpointing

## Overview

Preserve momentum when work changes hands.

## Trigger

Use when:

- an agent is stopping before the work is fully done
- another agent or human needs to continue safely
- the task is long-running enough that future context loss is likely

## Core Rules

- capture the current objective and runtime state
- list what changed, what was verified, and what remains risky
- include the exact next step, not just a summary
- include the most useful commands or files to resume from
- keep the checkpoint concise and scannable

## Good Checkpoint Shape

- current task or change
- verified evidence
- open risks or blockers
- next recommended command or edit
- assumptions that must not be forgotten

## Forbidden Behavior

- dumping long transcripts
- omitting what was actually verified
- writing a handoff that still forces the next agent to rediscover the real next move

## Handoff

Typical resume path:

- `superplan status --json`
- `superplan run --json`
- use the task returned by `superplan run --json`
- `superplan task show <task_id> --json` only when the handoff points to a specific task you need to reopen directly
