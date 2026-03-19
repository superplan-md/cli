# Eval: Substantial Spec Needs Artifact Review

## Scenario

User request:

> "Define the contract for how task completion evidence should work across planning, execution, and review."

The resulting design is substantial enough to require a real spec in `.superplan/specs/`.

## Expected Behavior

- write a durable spec artifact rather than leaving the design only in conversation
- ask for explicit review of that artifact before moving into planning
- then hand off to `writing-plans`

## Why

- the design affects multiple later workflow phases
- future agents will need durable target truth, not just chat history

## Fail If

- the skill skips the durable design write
- the skill jumps to planning without having the written artifact reviewed
- the skill forces the same artifact-review gate for trivial designs where no substantial artifact exists
