---
name: superplan-plan
description: Use when the target is understood and Superplan needs an implementation plan or execution sequence before task execution.
---

# Writing Plans

## Overview

Turn an understood target into the current execution path.

In Superplan, this usually means writing or updating `.superplan/plan.md`, while keeping graph truth, spec truth, and task-contract truth distinct.

## Trigger

Use when:

- the direction is clear enough that sequencing, coordination, or execution path is now the main problem
- approved design exists and the next need is executable planning
- work needs durable trajectory before execution starts

## Core Rules

- write the current path, not a fake immutable master plan
- use `.superplan/plan.md` for sequencing, dependency logic, and execution strategy
- derive tasks only as far as they are honestly shapeable now
- keep plans bite-sized and execution-oriented
- use exact artifact targets, verification paths, and handoffs rather than vague prose
- pull in `.superplan/context/`, `.superplan/decisions.md`, and `.superplan/gotchas.md` when they materially affect the path
- keep specs and plans distinct: specs capture target truth, plans capture trajectory
- when the plan already defines two or more new task contracts that are ready to author now, prefer handing off one `superplan task batch <change-slug> --stdin --json` scaffold step instead of repeated `superplan task new` calls

## Plan Discipline

Each plan step should be small enough to execute and verify cleanly.

Prefer:

- define proof before broad implementation
- define the next executable frontier
- make dependency logic explicit
- make likely interruption points explicit

## Bite-Sized Task Granularity

Treat "bite-sized" literally.

Prefer step granularity like:

- write the failing proof
- run it and confirm the expected failure
- make the minimal implementation change
- rerun the proof and confirm the expected pass
- record the resulting handoff or next frontier

If a step bundles multiple edits, multiple checks, and multiple decisions, it is too large.

## Execution-Path Detail

When writing `.superplan/plan.md`, encode enough detail that execution can proceed without guesswork:

- exact artifact targets
- exact verification commands or proof paths when known
- expected evidence
- dependency order
- next handoff to `superplan-shape` or `superplan-execute`

Vague sequencing is not planning.

## Recommended Step Shape

For each meaningful task or frontier unit, prefer this structure:

- target artifact or write surface
- step goal
- proof to run before or after the step
- expected output or decision
- next handoff

When the proof path is known, write it in explicit command style:

- `Run:` exact command or workflow
- `Expected:` what pass, fail, or decision signal should appear

When the plan includes task scaffolding, be explicit:

- do not hand-create individual `tasks/T-xxx.md` files in the plan or handoff
- use `superplan task new <change-slug> --title "<title>" --json` only when one task contract should be created now
- use `superplan task batch --stdin --json` when two or more task contracts are already clear enough to author in one pass
- when a graph and dependencies are already clear for multiple tasks, prefer one batch authoring step over repeated single-task creation
- prefer stdin over temporary files in agent-driven task authoring

## Forbidden Behavior

- writing plans that merely restate the request
- turning the plan into a spec
- pretending uncertain work is already fully decomposed
- forcing `spec -> plan -> tasks` ritual when a smaller structure is enough

## Decision Rules

Use `.superplan/decisions.md` for meaningful path choices, sequencing trade-offs, or user-approved changes that future execution should preserve.

Do not log every plan step.

## Handoff

Normal handoff is to `superplan-shape` or `superplan-execute`, depending on whether artifact shaping is still needed or the execution frontier is already clear.

If the plan still needs durable task contracts or graph structure, hand off to `superplan-shape`.
If the frontier is already explicit and bounded, hand off to `superplan-execute`.
