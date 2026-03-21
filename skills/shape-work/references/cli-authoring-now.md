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

But the current CLI does **not** parse or validate `tasks.md` yet.

Today, the executable surface is narrower:

- `superplan init` creates `.superplan/` and `.superplan/changes/`
- `superplan parse [path] --json` parses task contract markdown files
- `superplan status`, `superplan task show <task_id>`, `superplan task start`, and `superplan task complete` operate on parsed task files plus runtime state
- `superplan doctor` checks installation and setup, not shaped work

So shape work like this:

- author `tasks.md` only when graph visibility adds supervision value
- keep task contracts in `.superplan/changes/<slug>/tasks/T-xxx.md`
- validate task contracts with `superplan parse`
- inspect readiness with `superplan task`
- do not claim the current CLI validates `tasks.md`

## Current Authoring Workflow

1. Run `superplan init` if the repo is not initialized.
2. Create `.superplan/changes/<slug>/`.
3. Create `.superplan/changes/<slug>/tasks/`.
4. Optionally create `.superplan/changes/<slug>/tasks.md` as the human graph/index.
5. Create one `T-xxx.md` file per executable task.
6. Run `superplan parse --json .superplan/changes/<slug>`.
7. Fix diagnostics until each executable task is valid.
8. Use `superplan status` to confirm the ready frontier and `superplan task show <task_id>` when one task needs deeper inspection.
9. Hand off to execution with the exact validation commands already named.

## Task Contract Shape The Current CLI Parses

Current required frontmatter:

- `task_id`
- `status`

Current optional frontmatter used by readiness logic:

- `depends_on_all`
- `depends_on_any`

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
status: pending
depends_on_all: [T-001, T-002]
depends_on_any: []
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
- all `depends_on_all` tasks being done
- at least one `depends_on_any` task being done, if any are listed

That means task-file dependency fields are the current executable graph truth.

## Fields The Product Docs Want But The Current CLI Ignores

Safe to include for future-facing contracts, but not currently parsed:

- `change_id`
- `plan_id`
- `spec_ids`
- `assignee`
- `date`
- `title`
- `## Context`

These may still be useful for humans and for future CLI evolution.
Do not rely on the current CLI to validate them.

## Graph Features Planned But Not Yet CLI-Validated

Not implemented in the current CLI:

- `tasks.md` graph/index parsing
- workstream grouping
- `exclusive_group`
- graph-aware validation of the central index file
- CLI authoring commands such as `superplan change create` or `superplan task add`

Keep these distinctions explicit in the skill.

## Command Selection Rules

Use:

- `superplan doctor` for install/setup readiness
- `superplan parse --json` for task contract validity
- `superplan status` for the current ready-frontier summary
- `superplan task show <task_id>` for one task plus computed readiness reasons

Do not use:

- `superplan doctor` as a task validator
- future commands as if they already ship
- `tasks.md` as the only executable truth today
