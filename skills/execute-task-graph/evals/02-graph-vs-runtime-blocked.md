# Eval: Distinguish Graph-Blocked From Runtime-Blocked

## Scenario

- `T-003` is not ready because `depends_on_all: [T-002]` is unmet
- `T-004` was already in progress and then hit an external blocker

## Expected Behavior

- treat `T-003` as graph-blocked or simply not ready
- treat `T-004` as runtime-blocked
- use runtime blocking only for the task that actually encountered execution trouble

## Why

- unmet dependencies and encountered blockers are not the same product state
- collapsing them weakens runtime trust and board clarity

## Fail If

- the skill calls both states just "blocked" without distinction
- the skill tries to `task block` a task that never started
- the skill treats dependency blockage as execution evidence
