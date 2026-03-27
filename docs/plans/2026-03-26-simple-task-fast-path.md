# Simple Task Fast Path

Date: 2026-03-26

## Problem

Simple tracked tasks still feel too ceremony-heavy for agents.

Current friction points:

- `status` is often re-run even when the previous command already knows the frontier.
- `run` can still leave the agent needing another control-plane hop before obvious execution.
- routine completion historically required extra lifecycle handling even when acceptance criteria were already satisfied.
- the system mixes human task labels and runtime identity, which increases agent bookkeeping.

This makes agents more likely to chain commands, over-poll the control plane, or bypass the workflow and edit task artifacts directly.

## Goal

For small, obvious tasks, the default loop should feel like:

```text
run -> execute -> complete -> run
```

The workflow should still preserve:

- explicit runtime truth
- resumability
- unambiguous task identity
- review-only escalation when needed

## Proposed Fast Path

### 1. Make `run` the single pickup command

`superplan run --json` should return everything an agent needs to start work immediately:

- qualified task ref
- local task id
- change id
- absolute task file path
- description
- acceptance criteria
- readiness reasons if the task is not runnable
- next action guidance only when execution is not the obvious next step

Agent expectation:

```text
run once, then do the work
```

### 2. Treat review as an exception path

`superplan task review complete <task_ref> --json` should:

- verify acceptance criteria
- move routine completed work straight to `done`
- return `next_action.command = "superplan run --json"` when more work exists

Only route to `in_review` when strict review is explicitly required by task metadata or runtime policy.

Agent expectation:

```text
complete once, then pick up the next task
```

### 3. Stop requiring redundant frontier polling

Commands that already know the resulting frontier should not force a follow-up `status`.

Preferred behavior:

- `run` returns the active task and stop-style execution guidance
- `review complete` returns the next runnable command when one exists
- `repair fix` returns the refreshed queue summary directly
- `scaffold new` returns the new task ref and the direct activation command

`status` remains useful for:

- initial orientation
- human inspection
- explicit debugging
- workflow recovery after ambiguous or failed transitions

### 4. Separate display identity from runtime identity

The model should stay:

- local task label for display: `T-001`
- qualified runtime ref for commands/state: `change-slug/T-001`

This keeps UX readable while removing cross-change ambiguity.

### 5. Add a small-task mode by policy, not by branching the whole product

The fast path should be the default when all of these are true:

- one runnable task
- no blockers
- no feedback wait
- no explicit review requirement
- no runtime inconsistency

When any of those conditions fail, the current richer workflow can reassert itself.

## CLI Changes

### Recommended

1. Expand `run --json` payload to include full execution context.
2. Keep returning a qualified task ref for command routing.
3. Keep local `task_id` in payloads for readable displays.
4. Make `review complete` auto-finish routine work.
5. Return frontier-aware next actions from mutating commands instead of defaulting to `status`.

### Optional

1. Add `review_required: true|false` to parsed task/runtime payloads.
2. Add a compact queue summary block to `run`, `complete`, and `repair fix`.
3. Add `next_task_ref` to completion responses when the next runnable task is already known.

## Suggested Canonical Loops

### Small task

```text
superplan run --json
edit code
superplan task review complete <task_ref> --json
superplan run --json
```

### Blocked task

```text
superplan run --json
superplan task runtime block <task_ref> --reason "..." --json
```

### Feedback task

```text
superplan run --json
superplan task runtime request-feedback <task_ref> --message "..." --json
```

### Review-exception task

```text
superplan run --json
superplan task review complete <task_ref> --json
superplan task review approve <task_ref> --json
```

## Rollout Plan

### Phase 1

- finish the identity split between display ids and runtime refs
- ensure `run` returns full execution payloads
- ensure `review complete` auto-finishes routine work

### Phase 2

- reduce default `status` recommendations where the frontier is already known
- enrich mutating command responses with queue summaries

### Phase 3

- add explicit `review_required` policy
- make review-only branching intentional instead of implicit

## Success Signals

We should expect:

- fewer `status --json` calls per completed task
- fewer chained shell commands like `run && complete && approve`
- fewer direct edits to `.superplan/changes/.../tasks/T-xxx.md`
- more sessions that naturally follow `run -> execute -> complete -> run`

## Non-Goals

- removing runtime truth
- removing explicit blocking/feedback states
- hiding ambiguity when multiple tasks share a local label
- replacing the full tracked-work workflow for large or ambiguous changes
