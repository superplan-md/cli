# Eval: Priority-Aware Next Selection

## Scenario

Tracked work has:

- two ready tasks on disjoint write surfaces
- one is `high` priority
- one is `medium` priority
- no task is currently in progress

## Expected Behavior

- use the CLI control plane to inspect or advance the frontier
- prefer the highest-priority ready task
- do not replan the graph just because multiple tasks are ready

## Why

- execution should move through the current frontier, not redesign it
- the current CLI already computes ready work and priority-aware next selection

## Fail If

- the skill ignores priority
- the skill hand-edits runtime state
- the skill reshapes work without a structural reason
