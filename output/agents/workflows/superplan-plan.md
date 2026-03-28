---
name: superplan-plan
description: Use when the target is understood but the work still needs an execution path, task breakdown, or proof strategy before implementation begins.
---

# Writing Plans

## Overview

Turn an understood target into the current execution path.

In Superplan, this means writing or updating the current change plan through the CLI, while keeping graph truth, spec truth, and task-contract truth distinct.

## Trigger

Use when:

- the direction is clear enough that sequencing, coordination, or execution path is now the main problem
- approved design exists and the next need is executable planning
- work needs durable trajectory before execution starts

## Core Rules

- write the current path, not a fake immutable master plan
- use `superplan change plan set <change-slug> --stdin --json` for sequencing, dependency logic, and execution strategy
- derive tasks only as far as they are honestly shapeable now
- keep plans bite-sized and execution-oriented
- use exact artifact targets, verification paths, and handoffs rather than vague prose
- pull in `.superplan/context/`, `.superplan/decisions.md`, and `.superplan/gotchas.md` when they materially affect the path
- keep specs and plans distinct: specs capture target truth, plans capture trajectory
- when the plan already defines two or more new task contracts that are ready to author now, prefer handing off one `superplan task scaffold batch <change-slug> --stdin --json` scaffold step instead of repeated `superplan task scaffold new` calls

## Public-Facing Planning Rules

Make the useful reasoning visible to the user without narrating Superplan ceremony.

- lead with a brief read on what the user appears to want and what makes that intent matter
- state a recommendation, not just a neutral recap
- when multiple viable paths exist, present `2-3` concrete approaches with trade-offs before locking into one
- explain why the recommended path is better for this repo or request right now
- surface real opinions, risks, and sequencing judgments instead of flattening them into generic intent summaries
- keep internal phase names, command choreography, and storage details out of the foreground unless they directly affect the user's decision

If there is only one credible path, say that plainly and explain why alternatives are not worth carrying forward.

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

When writing a change plan through `superplan change plan set`, encode enough detail that execution can proceed without guesswork:

- exact artifact targets
- exact verification commands or proof paths when known
- expected evidence
- dependency order
- next handoff to `superplan-shape` or `superplan-execute`

Vague sequencing is not planning.

## User-Facing Output Shape

When planning is user-visible, prefer this public shape:

- lead: concise summary of the user's apparent goal, constraints, or acceptance intent
- approaches: only when real alternatives exist; make the trade-offs explicit
- recommendation: the path you think should be taken and why
- execution path: the concrete sequence of work, proof, and handoff

Do not reduce the response to "here is the plan" if the more helpful answer is "here is what I think you want, the realistic options, and the path I recommend."

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

- do not hand-create anything under `.superplan/`
- use `superplan change new <change-slug> --single-task "..." --json` for the one-task fast path
- use `superplan change task add <change-slug> --title "..." ... --json` to define tracked work and let the CLI place graph and task-contract artifacts correctly
- use `superplan change plan set <change-slug> --stdin --json` to write the plan itself instead of editing `plan.md` directly
- prefer the CLI path because it is faster, keeps placement correct, and prevents the model from learning bad file-editing habits

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
