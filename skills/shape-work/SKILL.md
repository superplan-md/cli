---
name: shape-work
description: Use when Superplan has decided to engage and the request needs durable work artifacts created at the right structure depth.
---

# Shape Work

## Overview

Create the minimum useful durable artifact structure and execution trajectory for the chosen depth.

This skill is not a task generator.
It is a trajectory shaper.

Its job is to shape work so the agent can move with bounded autonomy while staying aligned to the user's real expectations.

## Trigger

Use when:

- `route-work` has decided Superplan should engage
- the work needs durable structure created now
- the next step is to author plan, spec, or task artifacts proportional to the work
- the system must decide how much of the work is shapeable now versus discovery-driven
- the system must choose a verification loop before execution begins

## Stay Out

Do not shape work when:

- `route-work` decided to stay out
- execution is already fully shaped
- the request was already answered directly
- creating artifacts would add no value

## Inputs And Assumptions

Inputs:

- routing decision and chosen depth
- user request and raw narrative when available
- repo state
- current `.superplan/` artifacts if any
- workspace context when available
- existing verification loops
- existing user-owned harnesses, scripts, custom skills, and workflows
- recent decision log entries when relevant
- known gotchas when relevant

Assumptions:

- depth determines how much structure to create
- not all work is fully deterministic at shaping time
- some work should be represented as investigation, prototype, or decision-gate work before deeper decomposition
- the right shaping output is often a trajectory, not a frozen perfect plan

## Artifact Distinction Rule

Keep these layers distinct when the distinction adds clarity:

- graph truth: what work exists, how it depends, and what is ready now
- task-contract truth: what each bounded task means and what done requires
- runtime truth: what is happening now, what is blocked, and what is waiting on feedback

Artifact roles:

- `specs/*.md` capture behavior, constraints, interfaces, and acceptance intent
- `plan.md` captures implementation path, sequencing, and execution strategy
- graph/index artifacts capture dependency structure and workstreams
- task contracts capture bounded executable units

Canonical rule:

- specs constrain truth
- plans constrain trajectory
- task contracts, acceptance criteria, and checks constrain reality

Ownership rule:

- graph truth canonically owns task membership, `workstream`, `depends_on_all`, `depends_on_any`, and `exclusive_group`
- task-contract truth canonically owns meaning, context, acceptance criteria, verification, and expected evidence
- runtime truth canonically owns active, blocked, feedback, and event state

Once graph truth exists, do not use task files as the real owner of dependency edges or workstream membership.

Do not force all artifacts to exist for every request.

## CLI Alignment Now

Align shaping to the CLI that exists today, not only to future command ideas.

Product target:

- `changes/<slug>/tasks.md` is the human-readable graph/index surface
- `changes/<slug>/tasks/T-xxx.md` are the executable task contracts
- for very large changes, `tasks.md` may remain the root graph/index while delegating task-entry churn into graph shard files

Current CLI reality:

- `superplan init` creates `.superplan/` and `.superplan/changes/`
- `superplan parse [path] --json` parses task contract files, not `tasks.md`
- `superplan status` summarizes the ready frontier from task files plus runtime state
- `superplan task show <task_id>` explains one task's current readiness in detail
- `superplan doctor` checks setup and installation readiness, not shaped work correctness

Therefore:

- for tracked work, author root `tasks.md` according to the hard contract even though the current CLI does not yet validate that layer
- when Superplan is staying out, do not create graph artifacts
- keep current executable truth in task contract files the CLI can parse today
- choose current CLI validation commands explicitly during shaping
- distinguish current CLI commands from future CLI hooks

See `references/cli-authoring-now.md`.

## Current Contract Gap

The current skill contract is intentionally ahead of the current CLI parser/runtime.

Today the CLI effectively executes a narrow task-file contract:

- frontmatter such as `task_id`, `status`, `priority`, `depends_on_all`, and `depends_on_any`
- `Description`
- `Acceptance Criteria`
- runtime state such as `in_progress`, `done`, `blocked`, and `needs_feedback`

It does **not** yet fully validate or execute the product's intended hybrid contract:

- `changes/<slug>/tasks.md` as first-class graph/index truth
- root graph plus shard scaling for very large graphs
- workstream grouping
- `exclusive_group`
- richer task-contract metadata such as context, assignee, date, or spec linkage
- broader cross-artifact consistency checks

Shaping should stay honest about this gap.

- do not describe the current CLI as if the graph/index layer is already enforced
- do shape work toward the intended contract when the product direction depends on it
- when the contract gap itself is the blocker, call it out explicitly as CLI debt rather than hiding it in vague shaping prose

## Hard Contract Authoring Rule

When shaping tracked work, follow `references/graph-contract-authoring.md`.

Core rule:

- if Superplan is staying out, do not create graph artifacts
- if Superplan is engaged and the work is being tracked, create a root `changes/<slug>/tasks.md`

That includes:

- tracked `direct` work
- tracked `task` work
- tracked `slice` work
- tracked `program` work

For tiny tracked work, keep the graph minimal:

- one root `tasks.md`
- one task entry
- no explicit workstream grouping unless grouping materially helps

For large tracked work, shape the graph according to the hard contract:

- required root sections
- canonical IDs
- graph-only ownership for edges and workstream membership
- required task-file sections
- invariants and diagnostic risks considered during shaping
- root-plus-shard structure once scale justifies it

Do not author "graph-like" markdown that ignores the contract shape.

## Workspace Precedence Rule

Treat the workspace's existing setup as the default operating surface.

- inspect the workspace before inventing new Superplan-specific structure
- prefer repo-native scripts, harnesses, custom skills, and routines when they already solve the problem
- add Superplan-specific help only when the workspace does not already provide a better path

## Allowed Actions

- create one lightweight task for `direct`
- create one normal task for `task`
- create `plan.md` plus tasks for `slice` when sequencing matters
- create specs when misunderstanding the target is a bigger risk than sequencing
- create `changes/<slug>/tasks.md` as a human graph/index when dependency visibility is useful
- create a richer graph, plan, spec, and task set for `program` when the work genuinely needs all layers
- classify sub-work as `parallel-safe`, `serial`, or `wait-for-clarity`
- create investigation or uncertainty-reduction tasks
- create explicit decision gates when user judgment or product tradeoff is the real blocker
- define the initial executable frontier
- shape against graph invariants such as uniqueness, single membership, acyclicity, and exclusive-group legality
- identify likely diagnostic risks before execution begins
- choose the best available verification loop using repo resources first
- explicitly identify when the shaped work depends on CLI contract expansion rather than just better decomposition
- migrate legacy task-only work toward root graph ownership when reshaping existing tracked changes
- define multi-agent write boundaries when the graph is large enough to need them
- choose the current CLI validation path:
  - `superplan doctor` for install/setup readiness
  - `superplan parse [path] --json` for task contract validity
  - `superplan status` for current ready-frontier inspection
  - `superplan task show <task_id>` for one task's detailed readiness
- choose an autonomy class:
  - `autopilot`
  - `checkpointed autopilot`
  - `human-gated`
- define re-shape triggers
- define interruption points
- identify which shaping decisions should be written to durable decision memory

## Forbidden Behavior

- forcing every request through plan/spec/task ritual
- collapsing spec and implementation plan into the same vague artifact
- creating graph bloat for tiny work
- creating specs that do not materially help
- turning specs into pseudocode by default
- performing broad execution here
- creating tracked work without a root `changes/<slug>/tasks.md`
- authoring root graphs or shard files without the hard-contract section shape
- inventing unstable IDs or renumbering existing task IDs
- putting canonical dependency or workstream ownership in task files once graph truth exists
- shaping a graph without considering invariants like acyclicity, uniqueness, or single membership
- ignoring likely diagnostics the shaped graph would trigger
- omitting required task-file sections for created task contracts
- sharding tiny work by default
- partitioning very large graphs without explicit root registry ownership
- letting multiple agents edit the same graph-ownership layer casually when cleaner write boundaries are available
- claiming the current CLI validates `tasks.md` graph truth
- claiming `superplan doctor` validates shaped task artifacts
- using future commands as if they already exist
- hiding real CLI contract gaps behind generic statements like "capture this in the task graph" when no current graph parser exists
- pretending uncertain work is already cleanly decomposed
- pushing all ambiguity downstream into execution
- replacing a working repo-native workflow with a Superplan-specific one by default

## Output Schema

Every shaped output should make the following explicit:

- current objective
- work type:
  - `deterministic`
  - `investigative`
  - `taste-sensitive`
  - `decision-heavy`
  - `integration-heavy`
- autonomy class:
  - `autopilot`
  - `checkpointed autopilot`
  - `human-gated`
- initial executable frontier
- dependency logic
- graph structure strategy:
  - single-file graph
  - root graph plus shards
- graph authoring shape:
  - required root sections
  - flat graph, grouped graph, or shards
- ID strategy:
  - task IDs
  - workstream IDs if any
  - exclusive-group IDs if any
- ownership boundaries:
  - graph truth
  - task-contract truth
  - runtime truth
- parallelization assessment
- verification plan
- task contract profile:
  - executable
  - investigative
  - decision-gate
- current CLI validation path
- current contract ceiling
- invariants to preserve
- likely diagnostics or drift risks
- migration plan if reshaping legacy task-only work
- interruption points
- re-shape triggers
- expected evidence for completion
- meaningful decisions to record durably if the trajectory changes later

Outputs should make the next executable unit clear, not just the artifact inventory.
If the intended shape exceeds current CLI support, outputs should say so directly and identify the missing contract capability.
For large programs, outputs should make clear whether the graph is expected to stay in one root file or be partitioned into workstream shards.
For tracked work, outputs should make clear that root graph truth exists even when the graph is intentionally minimal.

See `references/graph-contract-authoring.md`, `references/trajectory-shaping.md`, `references/verification-selection.md`, and `references/interruption-policy.md`.

## Decision And Gotcha Rules

Use `.superplan/decisions.md` for meaningful shaping decisions such as depth correction, major verification-path choice, explicit decision gates, or changes to the shaped trajectory that future agents would need to preserve.

Do not log routine decomposition detail or transient execution notes.

Use `.superplan/gotchas.md` for repeated shaping traps, misleading repo patterns, and verification pitfalls likely to matter again.

See `references/gotchas.md`.

## Handoff

Likely handoffs:

- `execute-task-graph`
- user review when shaped work needs approval first
- back to `route-work` only if shaping discovers the engagement or depth decision was materially wrong

Internal support-skill usage may include:

- `brainstorming`
- `writing-plans`

Execution handoff should name the exact CLI checks that make the frontier legible now.
For large graphs, execution handoff should also name the ownership boundary between root graph, shard files, and task files.

## CLI Hooks

Current CLI:

- `superplan init`
- `superplan doctor`
- `superplan parse [path] --json`
- `superplan status`
- `superplan task show <task_id>`

Future CLI hooks:

- `superplan change create`
- `superplan task add`
- `superplan plan init`
- `superplan spec add`

## Validation Cases

Should create only a lightweight task:

- tiny real work with low complexity and clear scope
- tracked `direct` work should still create a minimal root `tasks.md` plus one task contract
- tiny tracked work may stay flat with no explicit workstream grouping

Should create one normal task:

- one bounded bugfix
- one bounded feature
- tracked `task` work should still create a root `tasks.md` plus one normal task contract
- small tracked work should not invent a meaningless single workstream just to satisfy ritual

Should create plan plus tasks:

- work with sequencing or multiple meaningful steps
- `slice` work should keep graph truth explicit even when the graph stays in one root file

Should create specs as well:

- ambiguity or edge cases make a spec materially useful
- larger initiatives with multiple workstreams

Should create investigation or decision-gate tasks:

- debugging with unknown root cause
- brownfield work where repo understanding is incomplete
- product work where the user's preference is the real acceptance oracle
- investigative tasks should still make their completion and evidence model explicit

Should align honestly to the current CLI:

- `tasks.md` may be authored for graph visibility, but task-file validation must run through `superplan parse`
- ready-frontier checks should name `superplan status` and `superplan task show <task_id>`
- shaping should not invent current commands for change or task creation
- shaping should still follow the hard contract even when the current parser only validates part of it

Should use root graph plus shards:

- when one graph file would exceed roughly 200 task entries
- when multiple workstreams need parallel authorship
- when 1000+ tasks are expected

Should preserve graph invariants:

- no duplicate task entries
- no missing task-file references
- no dependency cycles
- no illegal exclusive-group shape

Should preserve multi-agent boundaries:

- root graph owns workstream and shard registry
- shard files own task-entry churn
- task files own task-contract detail

Should prefer checkpointed autopilot:

- the work is mostly routine but has high-leverage risk points

Should prefer human-gated:

- strong taste sensitivity
- destructive or expensive changes
- hidden expectation risk is high
