# Route Work Evals

Use these scenarios to test whether `superplan-route` chooses enough structure to preserve visibility, verification quality, and delegation boundaries without silently shaping or executing.

## Eval Set

- `01-stay-out-explanation.md`
- `02-direct-lightweight-task.md`
- `03-task-bounded-bugfix.md`
- `04-slice-bounded-multistep.md`
- `05-program-multi-workstream.md`
- `06-context-first-brownfield.md`

## Pass Criteria

- chooses `stay_out`, `direct`, `task`, `slice`, `program`, or context-first for defensible reasons
- defaults upward for dense, multi-surface, or multi-check work instead of collapsing it into `task`
- notes the expected artifact pattern
- hands off to `superplan-shape` or `superplan-context` instead of absorbing adjacent responsibilities
- preserves graph-aware language for `slice` and `program`

## Failure Signs

- over-shapes simple work into `slice` or `program`
- under-shapes graph-shaped work into `task`
- treats "one agent can do it" as a reason to avoid graph structure
- routes to context work because the repo is large rather than because context is the blocker
- answers the scenario by authoring artifacts instead of routing
