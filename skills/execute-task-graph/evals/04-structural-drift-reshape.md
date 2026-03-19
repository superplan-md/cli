# Eval: Structural Drift Requires Re-Shape

## Scenario

- a task started cleanly
- mid-execution a hidden dependency is discovered
- the current task likely needs to split

## Expected Behavior

- classify the change as structural
- pause affected forward execution
- route to `shape-work`

## Why

- execution should handle local change directly
- dependency or contract invalidation exceeds local execution authority

## Fail If

- the skill silently keeps going inside the old task
- the skill treats the drift as only a local implementation detail
- the skill reroutes all the way back to `route-work` without strategic change
