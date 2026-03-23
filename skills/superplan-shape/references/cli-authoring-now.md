# CLI Authoring Now

Use this reference when shaping work against the current CLI implementation.

## Product Target Vs Current CLI

March 17 defines the target artifact model as:

```text
.superplan/changes/<slug>/
  tasks.md
  tasks/
    T-001.md
    T-002.md
```

That remains the product direction.

Today, the executable surface is:

- `superplan init --json` creates `.superplan/`, `.superplan/context/`, `.superplan/runtime/`, and `.superplan/changes/`
- `superplan change new <change-slug> --json` scaffolds a tracked change root
- `superplan validate <change-slug> --json` validates `tasks.md`, graph diagnostics, and graph/task-contract consistency
- `superplan task new <change-slug> --task-id <task_id> --json` scaffolds one graph-declared task contract without mutating `tasks.md`
- `superplan task batch <change-slug> --stdin --json` scaffolds multiple graph-declared task contracts from JSON stdin without mutating `tasks.md`
- `superplan parse [path] --json` parses task contract markdown files and overlays dependency truth from the validated graph
- `superplan status --json`, `superplan run --json`, `superplan task show <task_id> --json`, and `superplan task complete --json` operate on parsed task files plus runtime state
- `superplan doctor --json` checks installation and setup, not shaped work

So shape work like this:

- author `tasks.md` as the canonical graph whenever tracked work exists
- manual creation of individual `tasks/T-xxx.md` files is off limits
- once the graph in `tasks.md` is ready, run `superplan validate <slug> --json`
- use `superplan task new` for one task or `superplan task batch` for multiple tasks to mint the `T-xxx.md` task contracts by explicit `task_id`
- keep task contracts in `.superplan/changes/<slug>/tasks/T-xxx.md`
- use `superplan parse` for contract parsing and `superplan validate` for graph plus cross-artifact checks
- inspect readiness with `superplan status --json`, `superplan run --json`, and `superplan task show <task_id> --json` as needed
- do not split dependency ownership back into task-file frontmatter

## Current Authoring Workflow

1. Run `superplan init --json` if the repo is not initialized.
2. Run `superplan change new <slug> --json` to create `.superplan/changes/<slug>/` and `.superplan/changes/<slug>/tasks/`.
3. Create or refine `.superplan/changes/<slug>/tasks.md` as graph truth with explicit task ids and dependency edges.
4. Run `superplan validate <slug> --json`.
5. Use `superplan task new <slug> --task-id <task_id> --json` when exactly one graph-declared task contract is ready.
6. Use `superplan task batch <slug> --stdin --json` when two or more graph-declared task contracts are ready and can be scaffolded together.
7. Use the returned payload from `task new` or `task batch` directly instead of immediately calling `task show`.
8. Run `superplan validate <slug> --json` again after scaffolding.
9. Use `superplan status --json` to confirm the ready frontier and `superplan task show <task_id> --json` when one task needs deeper inspection.
10. Hand off to execution with the exact validation commands already named.

For agent-first flows, prefer stdin over temporary files. `--file <path>` remains available only as a fallback when the batch spec itself should persist.

## Batch Spec Shape

`superplan task batch` accepts either:

- a top-level array of task objects
- an object with a top-level `tasks` array

Useful fields per task object:

- `task_id`: required graph-declared task id
- `priority`: optional `high`, `medium`, or `low`
- `description`: optional description body; defaults to the graph title when omitted
- `acceptance_criteria`: optional array of checkbox text

Example:

```json
[
  {
    "task_id": "T-001",
    "priority": "high",
    "acceptance_criteria": [
      "CLI accepts a validated graph before scaffolding.",
      "Task contracts scaffold from graph-declared ids."
    ]
  },
  {
    "task_id": "T-002",
    "acceptance_criteria": [
      "Scaffold coverage proves graph and contract consistency."
    ]
  }
]
```

Agent-first example:

```bash
printf '%s' '[{"task_id":"T-001","priority":"high"},{"task_id":"T-002"}]' | superplan task batch improve-planning --stdin --json
```

## Task Contract Shape The Current CLI Parses

Current required frontmatter:

- `task_id`
- `change_id`
- `title`
- `status`

Current optional frontmatter commonly scaffolded:

- `priority`

Current required sections:

- `## Description`
- `## Acceptance Criteria`

Acceptance criteria must use markdown checkboxes:

- `- [ ] not yet done`
- `- [x] done`

Current valid status values:

- `pending`
- `in_progress`
- `done`

Example:

```md
---
task_id: T-003
change_id: improve-planning
title: Implement the parser error summary output
status: pending
priority: high
---

## Description
Implement the parser error summary output for invalid task contracts.

## Acceptance Criteria
- [ ] `superplan parse` reports invalid status values with a stable diagnostic code
- [ ] duplicate task ids are surfaced in diagnostics
```

## What The Current Parser Returns

`superplan parse --json` currently returns task data including:

- `task_id`
- `change_id`
- `title`
- `status`
- `depends_on_all`
- `depends_on_any`
- `description`
- `acceptance_criteria`
- `total_acceptance_criteria`
- `completed_acceptance_criteria`
- `progress_percent`
- `effective_status`
- `is_valid`
- `is_ready`
- `issues`

Current diagnostics include:

- `CHANGES_DIR_MISSING`
- `TASK_ID_MISSING`
- `INVALID_STATUS_VALUE`
- `TASK_WITH_NO_DESCRIPTION`
- `EMPTY_ACCEPTANCE_CRITERIA`
- `DUPLICATE_TASK_ID`
- `TASK_READ_FAILED`

## Readiness Semantics Now

The current CLI computes readiness from:

- task validity
- status not already `done`
- status not already `in_progress`
- all graph-owned `depends_on_all` tasks being done
- at least one graph-owned `depends_on_any` task being done, if any are listed

That means `tasks.md` is the executable graph truth and parse/runtime project those edges onto task contracts.

## Fields The Product Docs Want But The Current CLI Ignores

Safe to include for future-facing contracts, but not currently parsed:

- `plan_id`
- `spec_ids`
- `assignee`
- `date`
- `## Context`

These may still be useful for humans and for future CLI evolution.
Do not rely on the current CLI to validate them.

## Graph Features Planned But Not Yet Fully Runtime-Enforced

Not fully implemented in the current CLI:

- workstream grouping
- `exclusive_group` runtime semantics
- graph sharding for very large graphs
- CLI authoring commands such as `superplan change create` or `superplan task add`

Keep these distinctions explicit in the skill.

## Command Selection Rules

Use:

- `superplan validate <change-slug> --json` for graph and cross-artifact validation
- `superplan task new <change-slug> --task-id <task_id> --json` for one task contract
- `superplan task batch <change-slug> --stdin --json` for two or more task contracts
- `superplan doctor --json` for install/setup readiness
- `superplan parse --json` for task contract validity
- `superplan status --json` for the current ready-frontier summary
- `superplan task show <task_id> --json` for one task plus computed readiness reasons

Do not use:

- `superplan doctor --json` as a task validator
- future commands as if they already ship
- task-file dependency frontmatter as the source of graph truth
