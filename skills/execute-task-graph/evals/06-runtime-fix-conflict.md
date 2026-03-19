# Eval: Runtime Conflict Uses Deterministic Repair

## Scenario

- runtime state somehow shows multiple tasks in progress
- execution cannot safely continue until the conflict is resolved

## Expected Behavior

- use deterministic runtime repair such as `superplan task fix`
- use `task reset` only as an explicit recovery move when warranted
- avoid ad hoc file edits

## Why

- execution state should be repaired through the CLI transition layer
- manual repair weakens trust in runtime truth

## Fail If

- the skill edits runtime files directly
- the skill ignores the invariant violation and keeps executing
- the skill treats runtime corruption as a reason to broadly replan by default
