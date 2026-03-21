---
name: superplan-route
description: Use when Superplan is active and a repo-work request needs an engagement or structure-depth decision, especially when stay-out, context gaps, or direct/task/slice/program boundaries are ambiguous.
---

# Route Work

## Overview

Decide whether Superplan should engage at all, and if it should, choose the smallest useful structure depth.

This skill owns the `should_superplan_engage?` decision and the initial depth choice.

This skill routes only.
It does not shape artifacts.
It does not execute work.

## Trigger

Use when:

- `superplan-entry` has decided Superplan should at least evaluate engagement
- the request may need `stay_out`, `direct`, `task`, `slice`, `program`, or context-first routing
- the main question is how much structure helps, not how the structure should be authored

## Stay Out

Stay out when:

- the correct action is a direct answer or explanation
- no durable artifact, visibility benefit, or reusable context would help
- the work is conversational, ephemeral, or one-shot
- the request has already been satisfied without Superplan

If staying out:

- answer directly
- create no Superplan artifacts
- do not route to `superplan-shape`

## Inputs And Assumptions

Inputs:

- user request
- current repo and worktree state
- current `.superplan/` state if present
- workspace context quality and freshness
- whether the work looks greenfield, brownfield, or follow-on

Assumptions:

- structure depth is a workflow choice, not a philosophical category
- once Superplan engages, the smallest useful depth is preferred
- graph truth, task-contract truth, and runtime truth are distinct
- context risk can outweigh depth risk in brownfield work
- routing should usually be possible without CLI command-surface exploration

## Routing Heuristic

Use this decision order:

1. Ask whether Superplan should stay out entirely.
2. If not, ask whether the work is one bounded unit or graph-shaped work.
3. Ask whether missing or stale context is the real blocker.
4. Choose the smallest depth that preserves trust, visibility, and correct downstream shaping.

Prefer under-ceremony over over-ceremony only until trust or coordination would be lost.
If lack of structure would hide real dependencies, choose the next deeper mode.

## CLI Discipline

Routing is not permission to explore the CLI surface.

- if routing needs current Superplan state, use the one minimal command or artifact that answers it
- do not call `--help` or neighboring commands just to orient yourself when the route is already clear
- once the depth decision is clear, stop probing the CLI and hand off

## Depth Modes

- `stay_out`: direct answer, no durable artifact
- `direct`: engaged but tiny and obvious; usually create one lightweight tracked task for visibility, then execute immediately
- `task`: one bounded, reviewable task contract is enough
- `slice`: bounded multi-step work; usually needs a small implementation plan plus a small task graph
- `program`: broad, ambiguous, multi-workstream, or major-interface work; may need plan plus graph plus specs

Expected artifact pattern by depth:

- `direct`: usually `tasks.md` plus one lightweight CLI-minted task contract
- `task`: `tasks.md` plus one normal CLI-minted task contract
- `slice`: usually `plan.md`, `tasks.md`, and CLI-minted `tasks/T-*.md`; add specs only when target misunderstanding is the bigger risk than sequencing
- `program`: `plan.md`, `tasks.md`, CLI-minted `tasks/T-*.md`, and specs where multiple interfaces, expectations, or product truths need durable capture

Graph rule:

For `slice` and `program`, preserve:

- graph truth in the graph/index layer
- task-contract truth in task files
- runtime truth in execution state

Do not flatten graph-shaped work into a pile of task files.

See `references/depth-modes.md`.

## Allowed Actions

- decide `stay_out`
- decide `direct`
- decide `task`
- decide `slice`
- decide `program`
- decide whether context work should happen first
- produce a short rationale for the decision
- note the expected artifact pattern for the chosen depth

## Forbidden Behavior

- writing large artifacts by default
- doing full shaping here
- implementing the work here
- forcing spec-first or plan-first ritual
- over-decomposing small work
- routing to context first just because the repo is large
- treating task files as the whole tracked model
- choosing `program` just because the request sounds important
- using routing as an excuse for CLI command-surface exploration
- probing neighboring commands after the depth choice is already clear

## Context Routing Rule

Route to `superplan-context` first when:

- serious brownfield work lacks usable durable context
- stale context is likely to mis-shape downstream work
- follow-on work depends on stable product or architecture truths that are not surfaced well enough

Do not route to context first when:

- the repo is merely large
- the request is small and locally understandable
- the missing information is task-local and can be handled during shaping

## Decision And Gotcha Rules

Record only meaningful engagement and depth decisions in `.superplan/decisions.md`.

Good candidates to record:

- a surprising `stay_out` call that avoids ceremony
- a `direct` call for work that sounded bigger than it really was
- a context-first call where context risk clearly outweighed depth risk
- a hard `slice` versus `program` judgment

Do not log routine obvious cases.

Add a gotcha when the same routing mistake is likely to recur, especially:

- recurring over-shaping into `slice` or `program`
- recurring under-shaping into `direct` or `task`
- repeatedly mistaking context gaps for depth problems
- repeatedly flattening graph-shaped work into isolated task files

See `references/stay-out-cases.md` and `references/gotchas.md`.

## Outputs

Recommended output shape:

- engagement decision
- structure-depth mode
- expected artifact pattern
- context note if relevant
- short reason
- next skill recommendation

Example output categories:

- stay out
- engage lightly: `direct`
- engage minimally: `task`
- engage structurally: `slice`
- engage structurally: `program`
- engage contextually first

## Handoff

Likely handoffs:

- `superplan-shape` for `direct`, `task`, `slice`, or `program`
- `superplan-context` when context is the real blocker
- no further Superplan action for `stay_out`

## Future CLI Hooks

- `superplan route --json`
- `superplan route --explain`
- `superplan route --dry-run`
- `superplan doctor --engagement`

## Validation Cases

Should route to stay out:

- simple direct explanations
- summarization with no durable workflow value
- casual conversation with no repo-work consequence

Should route to `direct`:

- tiny but real work where visibility still helps
- obvious typo, docs, or config edits that should be tracked but not shaped heavily

Should route to `task`:

- one bounded bugfix or feature with clear acceptance criteria
- one reviewable unit where a normal task contract is enough

Should route to `slice`:

- bounded but multi-step work
- one workstream with meaningful sequencing or decomposition needs
- work where implementation planning matters more than spec clarification

Should route to `program`:

- large, ambiguous, or multi-workstream work
- work spanning multiple interfaces or product truths
- work where richer artifact structure is needed to preserve alignment

Should route to context first:

- serious brownfield work with no useful durable workspace context
- stale context likely to mislead shaping across surfaces

Pressure cases:

- a request that sounds strategically important but is actually one bounded task
- a request that sounds tiny but hides multi-surface dependencies
- a brownfield request where context risk is higher than execution complexity

Pass condition:

The skill chooses the smallest useful depth, preserves stay-out behavior, routes context gaps correctly, and does not silently absorb shaping or execution.
