# CLI Authoring Now

Use this reference when shaping work against the current CLI implementation.

## Product Target Vs Current CLI

March 17 defines the target artifact model as:

```text
~/.config/superplan/changes/<slug>/
  tasks.md
  tasks/
    T-001.md
    T-002.md
```

That remains the product direction.

Today, the executable surface is:

- `superplan init --yes --json` ensures the global Superplan root exists under `~/.config/superplan/` and installs any needed repo-local agent instructions
- `superplan change new <change-slug> --json` scaffolds a tracked change root
- `superplan change plan set <change-slug> --stdin --json` writes the change plan
- `superplan change spec set <change-slug> --name <spec-slug> --stdin --json` writes a change-scoped spec
- `superplan change task add <change-slug> --title "..." --json` adds a tracked task and scaffolds its contract
- `superplan validate <change-slug> --json` validates `tasks.md`, graph diagnostics, and graph/task-contract consistency
- `superplan task scaffold new <change-slug> --task-id <task_id> --json` scaffolds one graph-declared task contract without mutating `tasks.md`
- `superplan task scaffold batch <change-slug> --stdin --json` scaffolds multiple graph-declared task contracts from JSON stdin without mutating `tasks.md`
- `superplan parse [path] --json` parses task contract markdown files and overlays dependency truth from the validated graph
- `superplan status --json`, `superplan run --json`, `superplan task inspect show <task_ref> --json`, and `superplan task review complete --json` operate on parsed task files plus runtime state
- `superplan doctor --json` checks installation and setup, not shaped work

So shape work like this:

- do not hand-edit anything under `~/.config/superplan/`
- use `superplan change new --single-task` or `superplan change task add` to define tracked work
- use `superplan change plan set` and `superplan change spec set` to write change-scoped artifacts
- run `superplan validate <slug> --json` when graph validation matters
- keep task contracts in `~/.config/superplan/changes/<slug>/tasks/T-xxx.md`, but let the CLI create them
- use `superplan parse` for contract parsing and `superplan validate` for graph plus cross-artifact checks
- inspect readiness with `superplan status --json`, `superplan run --json`, and `superplan task inspect show <task_ref> --json` as needed
- do not split dependency ownership back into task-file frontmatter

## Current Authoring Workflow

1. Run `superplan init --yes --json` if the repo is not initialized.
2. Run `superplan change new <slug> --json` to create `~/.config/superplan/changes/<slug>/` and `~/.config/superplan/changes/<slug>/tasks/`.
3. Use `superplan change plan set`, `superplan change spec set`, and `superplan change task add` to place change-scoped artifacts through the CLI.
4. Run `superplan validate <slug> --json` when graph validation matters.
5. Use the returned payload from CLI authoring directly instead of immediately calling `task inspect show`.
6. Use `superplan status --json` to confirm the ready frontier and `superplan task inspect show <task_ref> --json` when one task needs deeper inspection.
7. Hand off to execution with the exact validation commands already named.

For agent-first flows, prefer stdin over temporary files. `--file <path>` remains available only as a fallback when the batch spec itself should persist.

## Batch Spec Shape

`superplan task scaffold batch` accepts either:

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
printf '%s' '[{"task_id":"T-001","priority":"high"},{"task_id":"T-002"}]' | superplan task scaffold batch improve-planning --stdin --json
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
- `superplan task scaffold new <change-slug> --task-id <task_id> --json` for one task contract
- `superplan task scaffold batch <change-slug> --stdin --json` for two or more task contracts
- `superplan doctor --json` for install/setup readiness
- `superplan parse --json` for task contract validity
- `superplan status --json` for the current ready-frontier summary
- `superplan task inspect show <task_ref> --json` for one task plus computed readiness reasons

Do not use:

- `superplan doctor --json` as a task validator
- future commands as if they already ship
- task-file dependency frontmatter as the source of graph truth
