---
name: superplan-debug
description: Use when tracked work hits a failing check, flaky result, runtime bug, or unexplained behavior and you need root cause before changing code.
---

# Systematic Debugging

## Overview

Debug by evidence and hypothesis, not patch roulette.

## Root-Cause Law

Do not start broad fixes before reproducing or characterizing the failure well enough to distinguish symptom from cause.

If the current evidence does not isolate the failure mode, gather more evidence first.

## Hard Gate

Do not propose or apply speculative fixes before Phase 1 has produced a concrete failure model.

## Trigger

Use when:

- execution is blocked by a bug, failing check, flaky result, or broken behavior
- unexpected behavior appears during tracked work
- the system is tempted to fix before understanding

## Phases

1. Reproduce or characterize the failure.
2. Narrow the failure surface with logs, scripts, tests, and diagnostics already trusted by the repo.
3. Form explicit hypotheses.
4. Run the cheapest discriminating check.
5. Fix the root cause.
6. Verify against the relevant task contract and acceptance criteria.

## Core Rules

- gather evidence from the repo's existing logs, scripts, harnesses, and diagnostics first
- change one variable at a time when narrowing the cause
- fix the root cause, not the most recent symptom
- if the bug reveals a durable trap, record it in `.superplan/gotchas.md`
- if the fix changes the intended path materially, update `.superplan/decisions.md`

## Forbidden Behavior

- guessing the fix before understanding the failure
- changing multiple variables at once and calling the result evidence
- treating one passing rerun as proof the root cause is solved
- rewriting the task contract just to make the bug look smaller

## Handoff

Once root cause is clear, execution may continue through `superplan-execute`.
If the investigation reveals structural drift, hand back to `superplan-shape`.
