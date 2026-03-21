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

- `superplan init --json` creates `.superplan/`, `.superplan/context/`, `.superplan/runtime/`, and `.superplan/changes/`
- `superplan change new <change-slug> --json` scaffolds a tracked change root
- `superplan task new <change-slug> --title "<title>" --json` scaffolds one task contract and appends a task entry to `tasks.md`
- `superplan task batch <change-slug> --stdin --json` scaffolds multiple task contracts from JSON stdin and appends task entries to `tasks.md`
- `superplan parse [path] --json` parses task contract markdown files
- `superplan status --json`, `superplan run --json`, `superplan task show <task_id> --json`, and `superplan task complete --json` operate on parsed task files plus runtime state
- `superplan doctor --json` checks installation and setup, not shaped work

So shape work like this:

- author `tasks.md` only when graph visibility adds supervision value
- manual creation of individual `tasks/T-xxx.md` files is off limits
- once the graph in `tasks.md` is ready, use `superplan task new` for one task or `superplan task batch` for multiple tasks to mint the `T-xxx.md` task contracts
- keep task contracts in `.superplan/changes/<slug>/tasks/T-xxx.md`
- validate task contracts with `superplan parse`
- inspect readiness with `superplan status --json`, `superplan run --json`, and `superplan task show <task_id> --json` as needed
- do not claim the current CLI validates `tasks.md`

## Current Authoring Workflow

1. Run `superplan init --json` if the repo is not initialized.
2. Run `superplan change new <slug> --json` to create `.superplan/changes/<slug>/` and `.superplan/changes/<slug>/tasks/`.
3. Create or refine `.superplan/changes/<slug>/tasks.md` as the human graph/index when graph visibility adds supervision value.
4. Use `superplan task new <slug> --title "<title>" --json` when exactly one new task contract is ready.
5. Use `superplan task batch <slug> --stdin --json` when two or more new task contracts are ready and can be scaffolded together.
6. Use the returned payload from `task new` or `task batch` directly instead of immediately calling `task show`.
7. Run `superplan parse --json .superplan/changes/<slug>`.
8. Fix diagnostics until each executable task is valid.
9. Use `superplan status --json` to confirm the ready frontier and `superplan task show <task_id> --json` when one task needs deeper inspection.
10. Hand off to execution with the exact validation commands already named.

For agent-first flows, prefer stdin over temporary files. `--file <path>` remains available only as a fallback when the batch spec itself should persist.

## Batch Spec Shape

`superplan task batch` accepts either:

- a top-level array of task objects
- an object with a top-level `tasks` array

Useful fields per task object:

- `ref`: optional local alias for other tasks in the same batch
- `title`: required summary used for the change index
- `priority`: optional `high`, `medium`, or `low`
- `description`: optional description body; defaults to the title when omitted
- `acceptance_criteria`: optional array of checkbox text
- `depends_on_all`: optional array of existing task ids
- `depends_on_any`: optional array of existing task ids
- `depends_on_all_refs`: optional array of same-batch refs
- `depends_on_any_refs`: optional array of same-batch refs

Example:

```json
[
  {
    "ref": "parser",
    "title": "Add batch parser",
    "priority": "high",
    "acceptance_criteria": [
      "CLI accepts a JSON batch file.",
      "Invalid batch payloads fail clearly."
    ]
  },
  {
    "ref": "tests",
    "title": "Add scaffold coverage",
    "depends_on_all_refs": ["parser"],
    "acceptance_criteria": [
      "Batch creation tests cover dependency ref resolution."
    ]
  }
]
```

Agent-first example:

```bash
printf '%s' '[{"ref":"parser","title":"Add batch parser"},{"title":"Add scaffold coverage","depends_on_all_refs":["parser"]}]' | superplan task batch improve-planning --stdin --json
```

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

- `superplan task new <change-slug> --title "<title>" --json` for one task contract
- `superplan task batch <change-slug> --stdin --json` for two or more task contracts
- `superplan doctor --json` for install/setup readiness
- `superplan parse --json` for task contract validity
- `superplan status --json` for the current ready-frontier summary
- `superplan task show <task_id> --json` for one task plus computed readiness reasons

Do not use:

- `superplan doctor --json` as a task validator
- future commands as if they already ship
- `tasks.md` as the only executable truth today
