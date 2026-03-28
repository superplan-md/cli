---
name: superplan-shape
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

- `superplan-route` has decided Superplan should engage
- the work needs durable structure created now
- the next step is to author plan, spec, or task artifacts proportional to the work
- the system must decide how much of the work is shapeable now versus discovery-driven
- the system must choose a verification loop before execution begins

## Stay Out

Do not shape work when:

- `superplan-route` decided to stay out
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
- shaping should stop once the minimum useful artifact set and next executable frontier are clear
- **multi-step work** means work with 3 or more distinct steps, or work where sequencing across files or components matters; do not rationalize 3-step work as "only two steps" to skip graph shaping

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

- `superplan init --yes --json` ensures the global Superplan root exists under `~/.config/superplan/` and installs any needed repo-local agent instructions
- `superplan context bootstrap --json` creates missing durable workspace context entrypoints
- `superplan context status --json` reports missing durable workspace context entrypoints
- `superplan change new <change-slug> --json` scaffolds a tracked change root plus change-scoped plan/spec surfaces
- `superplan change plan set <change-slug> --stdin --json` writes the change plan
- `superplan change spec set <change-slug> --name <spec-slug> --stdin --json` writes a change-scoped spec
- `superplan change task add <change-slug> --title "..." --json` adds graph truth and scaffolds the task contract in one CLI-owned write
- `superplan validate <change-slug> --json` validates `tasks.md`, graph diagnostics, and graph/task-contract consistency
- `superplan task scaffold new <change-slug> --task-id <task_id> --json` scaffolds one graph-declared task contract without mutating `tasks.md`
- `superplan task scaffold batch <change-slug> --stdin --json` scaffolds multiple graph-declared task contracts from JSON stdin without mutating `tasks.md`
- `superplan parse [path] --json` parses task contract files and overlays dependency truth from the graph
- `superplan status --json` summarizes the ready frontier from task files plus runtime state
- `superplan task inspect show <task_ref> --json` explains one task's current readiness in detail
- `superplan doctor --json` checks setup, overlay, and workspace-shape health

Therefore:

- for tracked work, define plans, specs, graph tasks, and workspace memory through CLI commands instead of editing Superplan state files directly
- when Superplan is staying out, do not create graph artifacts
- manual creation of anything under `~/.config/superplan/changes/<slug>/` is off limits
- use `superplan change new --single-task` or repeated `superplan change task add` calls to define tracked work quickly and correctly
- keep dependency truth in the CLI-owned change graph and task-contract truth in the CLI-owned task files
- choose current CLI validation commands explicitly during shaping
- distinguish current CLI commands from future CLI hooks

See `references/cli-authoring-now.md`.

## Task Authoring Rule

Manual creation of files under `~/.config/superplan/changes/<slug>/` is off limits.

Agents should spend their shaping effort deciding what tracked work exists, then use CLI commands that place artifacts correctly:

- `superplan change new <change-slug> --single-task "..." --json` for the one-task fast path
- `superplan change task add <change-slug> --title "..." ... --json` for additional tracked tasks
- `superplan change plan set <change-slug> --stdin --json` for change plans
- `superplan change spec set <change-slug> --name <spec-slug> --stdin --json` for change specs

Prefer these commands because they are the fastest way to stay helpful without teaching the model bad `.superplan` editing habits.

## Current Contract Gap

The CLI now validates and consumes the root graph contract, but the full product shape is still ahead of the runtime in a few places.

Today the CLI validates and executes:

- `changes/<slug>/tasks.md` as graph truth for task membership and dependency edges
- task-contract markdown with frontmatter such as `task_id`, `change_id`, `title`, `status`, and `priority`
- `Description`
- `Acceptance Criteria`
- runtime state such as `in_progress`, `done`, `blocked`, and `needs_feedback`

It does **not** yet fully execute every future graph/program feature:

- root graph plus shard scaling for very large graphs
- workstream-aware runtime behavior
- `exclusive_group` runtime semantics beyond structural validation
- richer task-contract metadata such as context, assignee, date, or spec linkage
- deeper plan/spec-driven orchestration

Shaping should stay honest about this gap.

- do not describe the current CLI as if every future artifact layer is already enforced
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
- one `superplan task scaffold new` task contract shell
- no explicit workstream grouping unless grouping materially helps

For large tracked work, shape the graph according to the hard contract:

- required root sections
- canonical IDs
- graph-only ownership for edges and workstream membership
- required task-file sections
- invariants and diagnostic risks considered during shaping
- root-plus-shard structure once scale justifies it

Do not author "graph-like" markdown that ignores the contract shape.

## CLI Discipline

Shaping is not permission to explore the CLI surface.

- use the current CLI contract already listed in this skill instead of probing adjacent commands
- do not call `--help` or overlapping authoring or diagnostic commands when `change new`, `task scaffold new`, `task scaffold batch`, `parse`, `status`, `task inspect show`, or `doctor` already cover the need
- use `superplan parse` for task validity, `superplan status --json` for frontier checks, `superplan task inspect show <task_ref> --json` for one task detail, and `superplan doctor --json` when install, workspace artifact, or task-state health is in doubt
- once the needed authoring or validation command is known, run it instead of exploring alternatives

## User Communication

Keep shaping internals out of routine user updates.

- do not narrate artifact choreography, skill usage, or command sequencing unless the user asked for that level of detail
- do not send updates that mainly report internal motion such as "shaping the change", "minting task contracts", or lists of explored files and commands
- communicate the user-relevant result instead: what structure is being added, what ambiguity is being reduced, what acceptance boundary is being defined, or what remains intentionally deferred
- if a plan or task split matters, explain it in project terms rather than Superplan jargon

## Workspace Precedence Rule

Treat the workspace's existing setup as the default operating surface.

- inspect the workspace before inventing new Superplan-specific structure
- prefer repo-native scripts, harnesses, custom skills, and routines when they already solve the problem
- add Superplan-specific help only when the workspace does not already provide a better path

## Allowed Actions

- create one lightweight task for `direct`
- create one normal task for `task`
- create `plan.md` plus tasks for `slice` when sequencing matters
- use `superplan task scaffold batch --stdin --json` when two or more task contracts are ready to be scaffolded together
- create specs when misunderstanding the target is a bigger risk than sequencing
- create `changes/<slug>/tasks.md` as canonical graph truth for tracked work
- use `superplan task scaffold new` for one task or `superplan task scaffold batch` for multiple tasks after graph structure is ready
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
  - `superplan validate <change-slug> --json` for graph validation and graph/task-contract consistency
  - `superplan doctor --json` for install/setup readiness
  - `superplan parse [path] --json` for task contract validity
  - `superplan status --json` for current ready-frontier inspection
  - `superplan task inspect show <task_ref> --json` for one task's detailed readiness
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
- hand-creating new `tasks/T-xxx.md` task contracts when `superplan task scaffold new` can mint the canonical ID and scaffold
- manually creating individual task files instead of using `superplan task scaffold batch --stdin --json` when multiple tasks are ready together
- using shell loops or direct file-edit rewrites to create or mutate task contracts instead of the CLI authoring commands; piping JSON into `superplan task scaffold batch --stdin --json` is fine, writing the task files yourself is not
- authoring root graphs or shard files without the hard-contract section shape
- jumping straight from a dense, ambiguous requirement dump into task scaffolding when clarification, spec, or plan work should happen first
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
- using shaping as an excuse for CLI command-surface exploration after the artifact and frontier decisions are already clear
- calling `--help`, `doctor`, `status`, or `task inspect show` without a concrete shaping reason
- pushing all ambiguity downstream into execution
- beginning execution without a complete scaffolded task graph when the work has 3 or more distinct steps
- rationalizing that work with 3+ steps is "only two steps" to avoid graph shaping
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

- `superplan-execute`
- user review when shaped work needs approval first
- back to `superplan-route` only if shaping discovers the engagement or depth decision was materially wrong

Internal support-skill usage may include:

- `superplan-brainstorm`
- `superplan-plan`

Execution handoff should name the exact CLI checks that make the frontier legible now.
For large graphs, execution handoff should also name the ownership boundary between root graph, shard files, and task files.

## CLI Hooks

Current CLI:

- `superplan init --yes --json`
- `superplan change new <change-slug> --json`
- `superplan validate <change-slug> --json`
- `superplan task scaffold new <change-slug> --task-id <task_id> --json`
- `superplan task scaffold batch <change-slug> --stdin --json`
- `superplan doctor --json`
- `superplan parse [path] --json`
- `superplan status --json`
- `superplan task inspect show <task_ref> --json`

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

Should use batch task authoring:

- when two or more new task contracts are already clear enough to scaffold now
- when repeated `task scaffold new` calls would only add agent churn rather than clarity
- when batch-local dependencies can be declared up front in one authoring pass

Should create specs as well:

- ambiguity or edge cases make a spec materially useful
- larger initiatives with multiple workstreams

Should create investigation or decision-gate tasks:

- debugging with unknown root cause
- brownfield work where repo understanding is incomplete
- product work where the user's preference is the real acceptance oracle
- investigative tasks should still make their completion and evidence model explicit

Should align honestly to the current CLI:

- `tasks.md` should be authored as graph truth and validated with `superplan validate`
- ready-frontier checks should name `superplan status --json` and `superplan task inspect show <task_ref> --json`
- shaping should use `superplan task scaffold new <change-slug> --task-id <task_id> --json` for one task and `superplan task scaffold batch --stdin --json` for two or more tasks
- shaping should still follow the hard contract even when runtime semantics lag behind structural validation

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
