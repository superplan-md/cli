# Graph Contract Authoring

Use this reference when `shape-work` is creating or reshaping tracked Superplan work.

This reference defines how to author graph truth and task-contract truth so the result is deterministic enough for later CLI parsing and validation.

## Root Rule

When Superplan is engaged and the work is being tracked, author a root graph artifact.

- tracked `direct` work: root `tasks.md` with one task entry; no explicit workstream grouping unless it materially helps
- tracked `task` work: root `tasks.md` with one normal task entry; no explicit workstream grouping unless it materially helps
- tracked `slice` work: root `tasks.md` plus task files; add workstreams only when they improve supervision
- tracked `program` work: root `tasks.md` plus task files; use workstreams and shards when scale requires them

Only the `stay_out` path should avoid creating graph truth.

## Root Graph Shape

`changes/<slug>/tasks.md` is the canonical root graph/index artifact.

Always include:

1. `# Task Graph`
2. `## Graph Metadata`
3. `## Graph Layout`

Add these only when they materially apply:

4. `## Workstreams`
5. `## Cross-Workstream Dependencies`
6. `## Notes`
7. `## Graph Shards`

Author these sections explicitly.
Do not write a vague prose summary and call it a graph.

Tiny tracked work may stay flat:

- root `tasks.md`
- no explicit `## Workstreams`
- one or a few task entries

## Shard Shape

Use graph shards only when the graph is large enough to justify them.

Shard file shape:

1. `# Graph Shard`
2. `## Shard Metadata`
3. `## Task Entries`

Rules:

- `tasks.md` remains the root registry and ownership surface
- a shard owns task entries for one primary workstream
- shard files do not redefine workstreams already declared in `tasks.md`

## Sharding Thresholds

Use a single root graph by default.

Introduce shards when any of these are true:

- roughly more than 200 task entries would live in one graph file
- one workstream can no longer be reviewed cleanly in the root file
- multiple agents need to author different workstreams in parallel
- diff churn in one graph file is becoming a merge hazard

For 1000+ tasks:

- always use workstream shards
- keep `tasks.md` as the root graph/index
- keep task-entry churn in shard files

## Canonical IDs

Use stable IDs.

- task IDs: `T-0001`, `T-0002`, `T-1042`
- workstream IDs: `WS-CLI`, `WS-API`, `WS-GRAPH`
- exclusive groups: `EG-001`, `EG-002`
- spec IDs when used: `S-001`

Rules:

- zero-pad task IDs to at least 4 digits
- never renumber an existing task
- never reuse an old task ID for a different meaning
- use stable workstream IDs, not ad hoc labels, when workstreams are in use

## Graph-Only Ownership

These fields belong canonically to graph truth only:

- task membership
- `workstream` when explicit grouping is used
- `depends_on_all`
- `depends_on_any`
- `exclusive_group`

Task files may mention graph context for readability, but repeated graph data is non-canonical and must not override graph truth.

Do not make task files the real owner of dependency edges once graph truth exists.

## Task Contract Shape

Each task file must use:

1. frontmatter
2. `## Context`
3. `## Description`
4. `## Acceptance Criteria`
5. `## Verification`
6. `## Evidence` optional
7. `## Notes` optional

Required frontmatter:

- `task_id`
- `change_id`
- `plan_id`
- `spec_ids`
- `assignee`
- `date`
- `status`
- `title`

Optional frontmatter:

- `priority`
- `labels`

Rules:

- `task_id` must match the filename
- `change_id` must match the owning change
- `plan_id` may be `null` when no plan artifact exists
- `spec_ids` may be `[]` when no spec artifact applies
- `status` is task-contract lifecycle state, not runtime state
- runtime states like `blocked` and `needs_feedback` do not belong in task frontmatter

## Investigative Vs Executable Tasks

Shape tasks explicitly as one of:

- executable
- investigative
- decision-gate

Rules:

- executable tasks require real acceptance criteria and a non-empty `## Verification`
- investigative tasks still need clear acceptance criteria, but verification may describe discovery evidence rather than a pass/fail command
- do not leave task type implicit when that changes what "done" means

## Invariants To Preserve While Shaping

Shape the graph so these invariants hold:

- every task ID is unique
- every workstream ID is unique
- every task file maps to exactly one graph entry
- every task belongs to exactly one primary workstream when explicit grouping is used
- tiny flat graphs may omit explicit workstream assignment
- every dependency target exists
- no task depends on itself
- the dependency graph is acyclic
- tasks in the same exclusive group do not depend on each other
- no task is duplicated across root graph and shard files
- required task file sections are present

If the proposed shape would violate one of these, reshape before execution.

## Diagnostics Mindset

Shape with likely parser diagnostics in mind.

High-value diagnostics to avoid up front:

- `GRAPH_SECTION_MISSING`
- `WORKSTREAM_UNDECLARED`
- `TASK_ENTRY_DUPLICATE`
- `TASK_FILE_MISSING`
- `TASK_FILE_UNREFERENCED`
- `DEPENDENCY_TARGET_UNKNOWN`
- `DEPENDENCY_CYCLE`
- `EXCLUSIVE_GROUP_INVALID`
- `TASK_CONTRACT_SECTION_MISSING`
- `TASK_ID_FILENAME_MISMATCH`
- `TASK_GRAPH_CONTRACT_CONFLICT`
- `GRAPH_SHARD_INVALID`

Shaping should not merely produce a plausible graph.
It should produce a graph that is unlikely to fail deterministic validation.

## Readiness Semantics

Keep three things separate:

- graph-ready
- runtime-blocked
- needs human feedback

Graph-ready means:

- all `depends_on_all` tasks are complete
- one `depends_on_any` task is complete, if any are listed
- no exclusive-branch rule invalidates the path

When shaping exclusive groups, make downstream assumptions explicit.

## Multi-Agent Write Boundaries

For large graphs, preserve these ownership boundaries:

- root `tasks.md` owns workstream registry and shard registry
- shard files own task-entry churn for one workstream
- task files own task-contract detail

Do not let multiple agents casually edit the same ownership layer when avoidable.

## Migration Rule

When reshaping legacy task-only work into the hard contract:

- keep existing task files as task-contract truth
- create root `tasks.md`
- move canonical dependency ownership into graph truth
- move workstream ownership into graph truth
- leave task-file edge fields only as temporary legacy data if needed
- treat legacy graph fields in task files as migration debt, not the desired end state

## Output Expectation

When shaping tracked work, the resulting output should make all of this legible:

- whether the graph is flat root-only, grouped root-only, or root-plus-shards
- the ID scheme in use
- the workstreams being created, if any
- the frontier and dependency logic
- the task contract shape expected for each created task
- the main invariants or diagnostics risks to watch
