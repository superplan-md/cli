---
name: "superplan"
description: "Use when working in a repository that uses the Superplan CLI for task parsing, task inspection, and runtime task execution state."
---

# Superplan

Use the Superplan CLI in the current repository as the source of truth for task state and task inspection.

## Workflow

1. Run `superplan parse --json` to inspect the current task set.
2. Run `superplan task show` to list parsed tasks.
3. Run `superplan task show <task_id>` to inspect one task.
4. Run `superplan task start <task_id>` to mark a task as in progress in runtime state.
5. Run `superplan task complete <task_id>` to complete a task when runtime and acceptance criteria allow it.

## Rules

- Prefer Superplan CLI task state over guessing from markdown alone.
- Do not modify task markdown files to track execution state.
- Runtime task state is stored in `.superplan/runtime/tasks.json`.
- If `superplan parse --json` returns diagnostics for a task, treat that task as invalid until the issues are resolved.

## Common Commands

- `superplan parse --json`
- `superplan task show`
- `superplan task show <task_id>`
- `superplan task start <task_id>`
- `superplan task complete <task_id>`
