# Execute Task Graph Gotchas

Record recurring execution traps here.

## Add A Gotcha When

- subagent coordination keeps creating the same integration failure
- a repo workflow repeatedly invalidates parallel verification
- runtime state keeps getting confused with graph readiness
- the same blocker pattern wastes time across tasks
- graph-blocked work keeps getting mislabeled as runtime-blocked
- agents keep inventing a persisted `review` runtime state that does not exist yet
- stale task contracts keep being used after structural drift
- runtime conflicts keep being papered over instead of using `task fix` or explicit reset

## A Surprise Becomes A Gotcha When

- it is likely to recur on later frontier execution
- it reveals a repeated parallelism, blocker, or runtime-state trap
- future agents would likely make the same execution mistake again

## Skill-Specific Vs Workspace-Wide

- skill-specific: the trap is about execution control, dispatch, or runtime-state judgment
- workspace-wide: the trap belongs to the repo, product surface, or recurring verification issues across skills

Workspace-wide traps should go to `.superplan/gotchas.md`.

## Keep Out

- one-off coding bugs
- shaping mistakes that belong in shaping gotchas
