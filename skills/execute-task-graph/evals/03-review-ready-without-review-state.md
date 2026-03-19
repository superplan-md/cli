# Eval: Review Ready Without Persisted Review State

## Scenario

- a task's implementation work is complete
- evidence has been gathered
- acceptance review is the next move

## Expected Behavior

- hand off to `review-task-against-ac`
- describe review readiness as a workflow output
- avoid inventing a persisted CLI `review` runtime state

## Why

- the current workflow supports review as a handoff
- the current CLI does not yet persist `review` as runtime state

## Fail If

- the skill claims review is already a stored runtime state
- the skill hand-edits runtime data to simulate review
- the skill skips review and claims completion directly
