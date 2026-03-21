# Runtime State

Runtime truth is not graph truth and not task-contract truth.

Current CLI-backed runtime storage:

- `.superplan/runtime/tasks.json`
- `.superplan/runtime/events.ndjson`

## Runtime Events

Runtime events should remain append-only execution history, not a second source of product truth.

Use them to preserve:

- what just happened
- what failed
- what needs attention
- enough history to understand why execution stalled or moved

## Graph Truth

- what tasks exist
- dependency edges
- what is graph-ready

## Task-Contract Truth

- what each task means
- acceptance criteria
- bounded write and review target

## Runtime Truth

- what is running now
- what is blocked now
- what needs feedback now
- what is ready for review now

## Graph-Blocked Vs Runtime-Blocked

Keep these distinct:

- graph-blocked: dependencies or graph readiness prevent a task from being executable yet
- runtime-blocked: execution started, but a real blocker was encountered while doing the work

Do not use runtime blocking to describe ordinary unmet dependencies.
Do not treat dependency blockage as proof that execution tried and failed.

## Current CLI Runtime States

- `in_progress`
- `blocked`
- `needs_feedback`
- `done`

## Workflow Outputs Not Yet Persisted As CLI State

- review ready
- localized re-shape required
- strategic re-route required

These can still be skill outputs and handoff states even when the CLI does not store them directly.

## Execution States To Surface

- in progress
- blocked
- needs feedback
- review ready
- localized re-shape required
- strategic re-route required

## Useful CLI Reads

- `superplan status --json`
- `superplan task show <task_id> --json`

## Runtime Summary Today

Today the narrow runtime summary surface is `superplan status --json`.

It gives:

- active task
- blocked tasks
- tasks needing feedback
- ready tasks

The March 17 product doc also points toward `.superplan/runtime/current.json` as a future stable summary artifact.
Do not pretend that persisted file exists if the CLI is only exposing the summary via command output.

## Event Payload Reality Vs Product Target

Current CLI events are still minimal and primarily carry:

- `ts`
- `type`
- `task_id`

The March 17 product direction points toward richer event payloads later, such as:

- actor
- source
- message
- reason
- blocking task context
- unmet acceptance criteria
- human-needed flags

Teach the product meaning now, but do not overclaim fields the current CLI does not actually persist.
