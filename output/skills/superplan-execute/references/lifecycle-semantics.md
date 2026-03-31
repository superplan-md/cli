# Lifecycle Semantics

Use this reference when deciding what execution move is appropriate.

## `run [task_id]`

Meaning:

- with no `task_id`, continue the current session's focused task or focused change frontier, or claim the next ready task only when no unrelated task is already in progress
- with `task_id`, explicitly start a ready task or resume a paused one
- the task contract is valid enough to execute
- the agent is now actively working it

Do not treat this as a blind status flip.

## `task runtime block`

Meaning:

- execution started
- a real blocker was encountered while working

This is not the same as unmet dependency readiness.

Use when:

- external information is missing
- a real blocker prevents continuation
- the task should pause without pretending the broader goal changed

## `task runtime request-feedback`

Meaning:

- the task cannot continue without a human decision
- the blocker is specifically a feedback or judgment need

Use when:

- user preference is the real oracle
- approval or decision changes downstream blast radius
- continuing would be guesswork

## `ready for AC review`

Meaning:

- active execution work is complete enough for acceptance review
- completion is not yet finalized

Current note:

- this is a workflow output and handoff state
- the current CLI does not persist it as a dedicated runtime state yet

## `task review complete`

Meaning:

- acceptance criteria are actually satisfied
- completion can be finalized safely

It should fail when:

- the task was never started
- the contract is invalid
- acceptance criteria are not fully complete

## Strictness

Execution transitions should be strict by default.

Fail hard on:

- impossible transitions
- invalid task contracts
- graph-not-ready starts
- completion attempts without satisfied acceptance criteria

## Idempotency

Safe repeated confirmation is acceptable when the CLI already supports it.

Examples:

- running a task that is already in progress
- rerunning `run <task_ref>` for the same active task

Do not invent idempotency by mutating runtime files manually.

## Recovery

Prefer:

- `superplan task repair fix` for deterministic runtime cleanup
- `superplan task repair reset <task_ref>` for explicit recovery when state must be cleared

Avoid:

- manual runtime file edits
- markdown status edits as a runtime workaround
