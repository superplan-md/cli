---
name: brainstorming
description: Use when work is ambiguous enough that expectations, constraints, taste, or acceptance intent must be clarified before Superplan can safely shape the work.
---

# Brainstorming

## Overview

Turn real ambiguity into an approved design before planning or execution proceeds.

This skill is for expectation discovery, not decomposition theater.

In Superplan, `brainstorming` is a support discipline skill. It does not decide whether Superplan should engage, and it does not own the full shaping phase.

## Hard Gate

Do not invoke implementation skills, shape broad work, or start execution until a design has been presented and approved.

This applies even when the work looks small.

If the right design is only three sentences, write three sentences.
Do not skip the design because the work feels obvious.

## Anti-Pattern: "This Is Too Simple To Need A Design"

That is rationalization.

Simple work often hides:

- unstated acceptance intent
- taste sensitivity
- hidden constraints
- wrong assumptions about what "done" means

Small work may need a short design.
It does not get to skip design discipline.

## Trigger

Use when:

- hidden expectations make direct shaping unsafe
- the user wants something built, changed, or clarified but key constraints are still implicit
- taste, product, or acceptance risk is high enough that the wrong early assumption would increase blast radius
- multiple materially different approaches exist and the trade-off needs approval before planning
- the next blocker is target clarity rather than execution sequencing

## Stay Out

Do not use when:

- the request is a simple explanation or answer
- the work is already clear enough for proportional shaping
- the ambiguity is casual ideation with no durable artifact, visibility, or reusable-context benefit
- `using-superplan` or `route-work` still needs to decide whether Superplan should engage
- the real problem is missing workspace context, which belongs to `context-bootstrap-sync`
- the real problem is execution trajectory or artifact depth, which belongs to `shape-work`

## Ordered Process

1. Explore repo context first.
2. Confirm the ambiguity is real and durable enough to justify brainstorming.
3. If the request is overscoped, decompose it before deeper refinement.
4. Ask one high-leverage question at a time.
5. Propose `2-3` approaches with trade-offs and a recommendation.
6. Present the design in sections scaled to complexity.
7. Get explicit approval before planning or execution.
8. Write the minimum durable design artifact.
9. If a substantial spec artifact was written, ask the user to review that artifact before moving on.
10. Hand off to `writing-plans`.

Do not reorder this flow casually.

## Context-First Rules

- inspect repo files, docs, nearby code, and existing Superplan artifacts before asking questions the workspace can already answer
- treat the user's raw narrative as signal, not noise
- prefer one high-leverage question at a time
- ask only questions whose answer materially changes the path
- if the repo already contains a strong pattern or constraint, incorporate it into the design instead of rediscovering it conversationally

## Overscope Detection

Before asking detailed questions, check whether the request actually contains multiple independent systems, workstreams, or product surfaces.

If it does:

- say so explicitly
- decompose the request into smaller designable units
- identify the best first slice to design
- do not pretend one clean design can safely cover everything at once

## Design Content Guidance

Scale the design to the work.

For small work, the design may be brief.
For larger or riskier work, cover the parts that materially prevent wrong execution, such as:

- target behavior or user outcome
- meaningful constraints and non-goals
- major approach trade-offs
- interface, workflow, or contract shape when relevant
- error, edge-case, or risk handling when relevant
- what evidence will later prove the design was implemented correctly

Do not expand this into boilerplate for its own sake.

## Durable Output Rules

Conversation is not durable enough by itself when future shaping or execution depends on the result.

Write the minimum durable artifact that preserves the approved truth:

- use `.superplan/specs/` when target behavior, interface expectations, or acceptance intent need durable capture
- use `.superplan/plan.md` when the main clarified output is trajectory, sequencing, or execution path
- use `.superplan/decisions.md` when the durable fact is an approved trade-off, preference, or boundary choice

Do not force a spec file for tiny or obvious work.
Do not skip the design-write step just because the conversation already contains the reasoning.

## Artifact Review Gate

Approval of the design is always required before planning proceeds.

If the design produced a substantial spec artifact, ask the user to review that artifact before moving into planning.

Do not force a written-artifact review loop when no meaningful artifact was created.

## Boundary With `shape-work`

`brainstorming` clarifies the target.

`shape-work` still owns:

- artifact depth
- graph structure
- autonomy class
- interruption points
- re-shape triggers
- verification-path shaping

`brainstorming` may recommend that a spec is needed.
It must not silently absorb the full shaping phase.

## Forbidden Behavior

- jumping straight to tasks before the target is understood
- asking low-value questions the workspace can answer
- skipping the approval loop because the work seems obvious
- treating "I can code this" as proof that the design is understood
- forcing a universal `spec -> plan -> tasks` ritual
- writing a large spec when a decision log entry or short plan update would preserve the truth just as well
- slipping into `shape-work`, execution, or completion review responsibilities

## Decision And Gotcha Rules

Use `.superplan/decisions.md` when:

- the user approves a meaningful design choice
- a trade-off changes the expected trajectory
- a clarified expectation will matter to later agents
- the boundary of scope or non-goals is explicitly set

Use `.superplan/gotchas.md` when:

- the same ambiguity trap is likely to recur
- the repo has a misleading pattern that causes repeated wrong assumptions
- a design misunderstanding would predictably waste future work

Do not log every clarifying answer.
Do not record transient conversation detail as durable memory.

## Handoff

The normal next skill is `writing-plans`.

If approval is still missing, stop and get it.
If the real blocker turns out to be stale workspace context, route back toward `context-bootstrap-sync`.
If the request collapses into already-clear tiny work, return control to the owning workflow phase rather than forcing more ceremony.

## Validation Cases

Should trigger:

- ambiguous feature request with hidden taste risk
- bounded feature where multiple viable approaches differ materially
- brownfield change where repo context answers some questions but acceptance intent is still unclear
- request that sounds singular but actually hides multiple workstreams

Should stay out:

- direct explanation-only requests
- casual ideation with no durable workflow value
- tiny already-clear work where proportional shaping can proceed directly
- cases where the real missing prerequisite is context bootstrap rather than design clarification

Should fail if:

- it skips context inspection and asks avoidable questions
- it asks multiple low-leverage questions in one burst
- it presents only one path when real alternatives exist
- it proceeds without approval
- it forces a spec file when a smaller durable artifact would do
- it turns into `shape-work` or execution
