# Execute Task Graph Evals

## Should Trigger

- one or more graph-ready tasks exist

## Should Stay Out

- shaping is incomplete
- context is the real blocker

## Ambiguous Boundary

- a discovery during execution could be either a local trajectory change or a structural change requiring re-shape

## Overlap Boundary

- confirm it does not silently replan work that belongs back in `shape-work`
- confirm strategic goal change routes up to `route-work`
- confirm it uses current CLI commands for runtime inspection and transitions
- confirm it does not pretend `review` is a persisted runtime state today
- confirm graph-blocked and runtime-blocked are not collapsed into one vague state

## Handoff Check

- review-ready work hands off to `review-task-against-ac`
- structural drift hands off to `shape-work`
- strategic drift hands off to `route-work`
- blocked and feedback states route through current CLI transitions, not markdown edits
- runtime corruption or conflicting active tasks route through `task fix` or explicit reset, not ad hoc mutation

## Pressure Scenario

- two ready tasks, one verifier opportunity, one hidden dependency discovered mid-run

## Scenario Files

- `01-priority-next-selection.md`
- `02-graph-vs-runtime-blocked.md`
- `03-review-ready-without-review-state.md`
- `04-structural-drift-reshape.md`
- `05-strategic-drift-reroute.md`
- `06-runtime-fix-conflict.md`

## Pass Condition

The skill uses bounded execution, relies on the current CLI control plane, classifies change as local, structural, or strategic, and routes review, re-shape, or re-route explicitly instead of replanning silently.
