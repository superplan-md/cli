# Eval: Strategic Drift Requires Re-Route

## Scenario

- tracked work is underway
- the user changes the top-level goal
- the old engagement or depth decision may no longer be right

## Expected Behavior

- classify the change as strategic
- stop broad execution
- route to `route-work`

## Why

- goal change exceeds execution authority
- the workflow spine should make the new engagement or depth decision explicitly

## Fail If

- the skill keeps executing under the old objective
- the skill routes only to `shape-work` when the top-level goal changed
- the skill treats a strategic change as a local execution choice
