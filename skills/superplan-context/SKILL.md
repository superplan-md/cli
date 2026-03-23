---
name: superplan-context
description: Use when brownfield or long-running work needs durable workspace context created, indexed, or updated under .superplan/context.
---

# Context Bootstrap Sync

## Overview

Create or update durable workspace context that should persist beyond the current task.

This skill owns Superplan's durable context layer, not active task state.

## Trigger

Use when:

- serious work begins and useful workspace context is missing
- brownfield work would otherwise start cold
- meaningful durable context drift is discovered

## Stay Out

Do not run when:

- the work is tiny
- the observation is transient and task-specific
- the information is unlikely to matter again
- the request is purely conversational

## Inputs And Assumptions

Inputs:

- current repo structure
- existing `.superplan/context/` if present
- current task or request
- stable findings gathered during repo exploration

Assumptions:

- context should contain stable reusable truth
- transient task, graph, and runtime state belong elsewhere

## Stable Layer Model

Keep these layers distinct:

- stable context: reusable architecture, conventions, workflows, and non-obvious repo truths
- active work: plans, specs, tasks, and current trajectory decisions
- live runtime: in-progress execution state, blockers, and review movement

Use `.superplan/context/README.md` as the entrypoint and `.superplan/context/INDEX.md` as the routing layer into deeper context docs.

See `references/context-indexing.md` and `references/durable-context-rules.md`.

## Allowed Actions

- create initial durable workspace context
- update stale context when important drift is found
- summarize what changed in context
- keep the context layer proportionate and reusable

## Forbidden Behavior

- storing transient runtime state as durable context
- rewriting the whole context layer casually
- turning every observation into context
- hijacking active task shaping or execution responsibilities

## Decision And Gotcha Rules

Use `.superplan/decisions.md` only when a context update materially changes how future shaping or execution should reason about the repo.

Do not log routine indexing or summary updates there.

Use `.superplan/gotchas.md` for recurring context traps, misleading repo layouts, stale-doc pitfalls, or indexing failures likely to waste time again.

See `references/gotchas.md`.

## Outputs

Expected output categories:

- context created
- context updated
- no context action needed

When changed, output should say what durable truth was added or revised.

## Handoff

Likely handoffs:

- `superplan-route`
- `superplan-shape`

## CLI Hooks

- `superplan context bootstrap`
- `superplan context status`

Use the command surface that exists today instead of treating context bootstrap as a manual convention.

## Validation Cases

Should trigger:

- serious brownfield repo work with no useful durable context
- known architectural drift likely to mislead future work

Should stay out:

- one-off small fixes
- temporary debugging observations
- ephemeral state from current execution
