---
name: retrospective-postmortem
description: Use after a task completes, fails, or stalls to capture what went wrong, what almost went wrong, and what should change next time.
---

# Retrospective Postmortem

## Overview

Turn completed or failed work into reusable learning.

This skill exists to reduce repeated mistakes, not to assign blame.

## Trigger

Use when:

- a task finished and the team wants to learn from it
- a task failed, thrashed, or took an unexpected path
- a recurring trap or process weakness became visible

## Stay Out

Do not use when:

- execution is still actively blocked on basic facts
- the task is mid-flight and the right next move is still direct execution
- there is nothing durable to learn beyond ordinary completion notes

## Core Rules

- separate facts, causes, and follow-up changes
- capture what went wrong and what almost went wrong
- identify one or two concrete rules, checks, or habits that would prevent recurrence
- keep the writeup concise enough to be reusable
- record recurring traps in `.superplan/gotchas.md`
- record process or policy changes in `.superplan/decisions.md`

## Forbidden Behavior

- blame-oriented writing
- vague lessons like "be more careful"
- rewriting history to make the path look cleaner than it was
- producing a long transcript instead of actionable learning

## Handoff

Likely follow-ons:

- `regression-guarding` when a test or proof path should be added
- `docs-sync` when the docs or help misled the work
- `shape-work` when the underlying task breakdown needs to change
